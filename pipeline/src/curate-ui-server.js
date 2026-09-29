// Local-only browser UI for curation — same underlying read/write logic as
// curate.js (see curationStore.js), just a nicer front end for review/rate/tag.
// Also serves a second tab for round scheduling (round scheduling design doc
// §5) — same underlying read/write logic as create-pool.js/assign-day.js/
// review-schedule.js/build-rounds.js, via poolStore.js.
// Not part of the shipped game; this process only ever binds to localhost.
//
// Usage: node src/curate-ui-server.js [port]   (default port 5177)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { SECTIONS, appendApproved, buildApprovedRecord, loadJson, loadPendingAcrossYears, markManualRejected, updateApprovedText, yearFromPubDate, APPROVED_PATH } from './curationStore.js';
import { dateStringToRoundId, todayDateString } from './dateUtils.js';
import { assignedPoolIds, loadApproved, loadPools, loadRounds, loadSchedule, nextPoolId, replacePoolHeadline, reorderPoolHeadlines, savePools, saveRounds, saveSchedule } from './poolStore.js';

const PORT = Number(process.argv[2]) || 5177;
const INDEX_HTML_PATH = new URL('./curate-ui.html', import.meta.url);

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {};
}

async function handleGetPending(res, url) {
  const yearMinRaw = url.searchParams.get('yearMin');
  const yearMaxRaw = url.searchParams.get('yearMax');
  const sectionsRaw = url.searchParams.get('sections'); // comma-separated

  const yearMin = yearMinRaw ? Number(yearMinRaw) : null;
  const yearMax = yearMaxRaw ? Number(yearMaxRaw) : null;
  const sections = sectionsRaw ? sectionsRaw.split(',').filter(Boolean) : null;

  const { years, total, approved, autoRejectedCount, manualRejectedCount, unscoredCount, pending, approvedBySection, approvedByDecade } =
    await loadPendingAcrossYears({ yearMin, yearMax, sections });

  sendJson(res, 200, {
    years,
    total,
    approvedCount: approved.length,
    approvedBySection,
    approvedByDecade,
    autoRejectedCount,
    manualRejectedCount,
    unscoredCount,
    pending: pending.slice(0, 200), // cap payload size; UI re-fetches as it works through them
    pendingCount: pending.length,
    sections: SECTIONS,
  });
}

async function handleDecide(req, res) {
  const body = await readBody(req);
  const { action, record } = body;

  if (!record || !record.nytId) return sendJson(res, 400, { error: 'Missing record.' });
  if (!['approve', 'reject', 'skip'].includes(action)) return sendJson(res, 400, { error: 'Invalid action.' });

  if (action === 'skip') {
    return sendJson(res, 200, { ok: true, approved: false });
  }

  if (action === 'reject') {
    const year = yearFromPubDate(record.pubDate);
    if (!year) return sendJson(res, 400, { error: 'Could not determine year for this record.' });
    try {
      await markManualRejected(record.nytId, year);
      return sendJson(res, 200, { ok: true, approved: false });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  try {
    const newRecord = buildApprovedRecord(record, {
      difficulty: Number(body.difficulty),
      section: body.section,
    });
    const approved = await loadJson(APPROVED_PATH, []);
    // Guard against double-submission (e.g. a double click) racing two writes.
    if (approved.some((a) => a.nytId === newRecord.nytId)) {
      return sendJson(res, 200, { ok: true, approved: true, approvedCount: approved.length });
    }
    const updated = await appendApproved(approved, newRecord);
    sendJson(res, 200, { ok: true, approved: true, approvedCount: updated.length });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

// --- Round scheduling (round scheduling design doc §5) ---

function poolHeadlineIds(pool) {
  return new Set((pool?.headlines ?? []).map((h) => h.id));
}

function yearFromApprovedId(id) {
  const m = String(id).match(/^nyt-(\d{4})-/);
  return m ? Number(m[1]) : null;
}

// Mirrors create-pool.js's advisory checks, returned as data instead of
// console.warn so the UI can render them — "warn, never block" for these.
// Headline count is enforced separately as a hard block (UI-only tightening;
// exactly 5 headlines per pool, always).
function buildPoolWarnings(headlines, ids) {
  const warnings = [];
  for (const h of headlines) {
    if (h.section === null) warnings.push(`Headline id "${h.id}" not found in approved.json — stored as-is.`);
  }
  const sections = new Set(headlines.map((h) => h.section));
  if (headlines.length > 1 && sections.size === 1) {
    warnings.push(`All ${headlines.length} headlines share the same section ("${[...sections][0]}") — no variety.`);
  }
  const decadeCounts = new Map();
  for (const id of ids) {
    const year = yearFromApprovedId(id);
    if (year == null) continue;
    const decade = Math.floor(year / 10) * 10;
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
  }
  const repeatedDecades = [...decadeCounts.entries()].filter(([, count]) => count > 1);
  if (repeatedDecades.length) {
    const desc = repeatedDecades.map(([decade, count]) => `${decade}s (${count})`).join(', ');
    warnings.push(`Two or more headlines fall in the same decade: ${desc}.`);
  }
  return warnings;
}

// Browse/search approved.json for the pool-creation picker. Not the same
// data as curation's /api/pending (that's unapproved raw records) — this is
// the already-approved backlog, which is what pools are built from.
async function handleApprovedHeadlines(res, url) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const section = url.searchParams.get('section') || null;
  const yearMinRaw = url.searchParams.get('yearMin');
  const yearMaxRaw = url.searchParams.get('yearMax');
  const yearMin = yearMinRaw ? Number(yearMinRaw) : null;
  const yearMax = yearMaxRaw ? Number(yearMaxRaw) : null;
  const excludeUsed = url.searchParams.get('excludeUsed') === '1';
  const excludeInAnyPool = url.searchParams.get('excludeInAnyPool') === '1';

  const [approved, schedule, pools] = await Promise.all([loadApproved(), loadSchedule(), loadPools()]);

  let usedIds = null;
  if (excludeUsed) {
    usedIds = new Set();
    for (const poolId of assignedPoolIds(schedule)) {
      const pool = pools[poolId];
      if (pool) for (const h of pool.headlines) usedIds.add(h.id);
    }
  }

  // Distinct from excludeUsed: this scans EVERY pool regardless of whether
  // it's assigned to a date — "already in a pool at all" vs. "already on the
  // schedule" are different questions once pools can sit unassigned for a
  // while (round scheduling doc §5.1/§5.2's decoupled phases).
  let inAnyPoolIds = null;
  if (excludeInAnyPool) {
    inAnyPoolIds = new Set();
    for (const pool of Object.values(pools)) {
      for (const h of pool.headlines) inAnyPoolIds.add(h.id);
    }
  }

  let results = approved;
  if (q) results = results.filter((a) => a.text.toLowerCase().includes(q));
  if (section) results = results.filter((a) => a.section === section);
  if (yearMin != null) results = results.filter((a) => a.year >= yearMin);
  if (yearMax != null) results = results.filter((a) => a.year <= yearMax);
  if (usedIds) results = results.filter((a) => !usedIds.has(a.id));
  if (inAnyPoolIds) results = results.filter((a) => !inAnyPoolIds.has(a.id));

  const total = results.length;
  const sorted = results
    .slice()
    .sort((a, b) => b.year - a.year)
    .map((a) => ({ id: a.id, text: a.text, year: a.year, section: a.section, difficulty: a.difficulty }));

  sendJson(res, 200, { total, results: sorted, sections: SECTIONS });
}

// Fixes typos/wording on an already-approved headline, right where a curator
// is browsing candidates for a pool. approved.json is the only place headline
// text lives — pools/schedule/rounds all reference it by id — so this is the
// one place a fix needs to happen to take effect everywhere.
async function handleEditApprovedText(req, res) {
  const body = await readBody(req);
  const { id, text } = body;
  if (!id) return sendJson(res, 400, { error: 'Missing id.' });

  try {
    const record = await updateApprovedText(id, text);
    sendJson(res, 200, { ok: true, id: record.id, text: record.text });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

async function handleScheduleState(res) {
  const [pools, schedule, approved, rounds] = await Promise.all([loadPools(), loadSchedule(), loadApproved(), loadRounds()]);
  const approvedById = new Map(approved.map((a) => [a.id, a]));
  const assigned = assignedPoolIds(schedule);

  const decorateHeadline = (h) => {
    const record = approvedById.get(h.id);
    return {
      id: h.id,
      section: h.section ?? record?.section ?? null,
      text: record ? record.text : null,
      year: record ? record.year : yearFromApprovedId(h.id),
      difficulty: record ? record.difficulty : null,
      found: Boolean(record),
    };
  };

  const poolsOut = Object.values(pools)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((pool) => ({
      id: pool.id,
      createdAt: pool.createdAt,
      assigned: assigned.has(pool.id),
      headlines: pool.headlines.map(decorateHeadline),
    }));

  const scheduleOut = Object.entries(schedule)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, poolId]) => {
      const pool = pools[poolId];
      return {
        date,
        poolId,
        missingPool: !pool,
        headlines: pool ? pool.headlines.map(decorateHeadline) : [],
        shipped: date <= todayDateString() && Boolean(rounds[dateStringToRoundId(date)]),
      };
    });

  sendJson(res, 200, {
    sections: SECTIONS,
    approvedCount: approved.length,
    pools: poolsOut,
    schedule: scheduleOut,
    today: todayDateString(),
  });
}

async function handleCreatePool(req, res) {
  const body = await readBody(req);
  const ids = Array.isArray(body.headlineIds) ? body.headlineIds.filter(Boolean) : [];
  // UI-only tightening beyond create-pool.js's CLI behavior: exactly 5,
  // always — hard block, not a warning.
  if (ids.length !== 5) return sendJson(res, 400, { error: `A pool must have exactly 5 headlines (got ${ids.length}).` });

  const approved = await loadApproved();
  const approvedById = new Map(approved.map((a) => [a.id, a]));

  const headlines = ids.map((id) => {
    const record = approvedById.get(id);
    return record ? { id, section: record.section } : { id, section: null };
  });

  const warnings = buildPoolWarnings(headlines, ids);

  const pools = await loadPools();
  const id = nextPoolId(pools);
  pools[id] = { id, createdAt: new Date().toISOString(), headlines };
  await savePools(pools);

  sendJson(res, 200, { ok: true, poolId: id, warnings });
}

async function handleAssignDay(req, res) {
  const body = await readBody(req);
  const { date, poolId } = body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return sendJson(res, 400, { error: 'Invalid date — expected YYYY-MM-DD.' });
  if (!poolId) return sendJson(res, 400, { error: 'Missing poolId.' });

  const [pools, schedule] = await Promise.all([loadPools(), loadSchedule()]);
  const warnings = [];

  if (schedule[date]) warnings.push(`${date} already assigned to ${schedule[date]} — overwriting with ${poolId}.`);

  const pool = pools[poolId];
  if (!pool) {
    warnings.push(`Pool id "${poolId}" not found in round-pool.json — assigning anyway.`);
  } else {
    const ids = poolHeadlineIds(pool);
    for (const headlineId of ids) {
      const clashDates = [];
      for (const [otherDate, otherPoolId] of Object.entries(schedule)) {
        if (otherDate === date) continue;
        const otherPool = pools[otherPoolId];
        if (otherPool && poolHeadlineIds(otherPool).has(headlineId)) clashDates.push(otherDate);
      }
      if (clashDates.length) warnings.push(`Headline "${headlineId}" also appears on ${clashDates.join(', ')} — cooldown clash.`);
    }
  }

  schedule[date] = poolId;
  await saveSchedule(schedule);
  sendJson(res, 200, { ok: true, warnings });
}

async function handleUnassignDay(req, res) {
  const body = await readBody(req);
  const { date } = body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return sendJson(res, 400, { error: 'Invalid date — expected YYYY-MM-DD.' });

  const schedule = await loadSchedule();
  if (!schedule[date]) return sendJson(res, 200, { ok: true, warnings: [`${date} was not assigned — nothing to unassign.`] });

  const removedPoolId = schedule[date];
  delete schedule[date];
  await saveSchedule(schedule);
  sendJson(res, 200, { ok: true, warnings: [], removedPoolId });
}

async function handleReorderPool(req, res) {
  const body = await readBody(req);
  const { poolId, orderedIds } = body;
  if (!poolId) return sendJson(res, 400, { error: 'Missing poolId.' });
  if (!Array.isArray(orderedIds) || !orderedIds.length) return sendJson(res, 400, { error: 'orderedIds must be a non-empty array.' });

  try {
    const pool = await reorderPoolHeadlines(poolId, orderedIds);
    sendJson(res, 200, { ok: true, pool });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

async function handleReplacePoolHeadline(req, res) {
  const body = await readBody(req);
  const { poolId, index, newHeadlineId } = body;
  if (!poolId) return sendJson(res, 400, { error: 'Missing poolId.' });
  if (!newHeadlineId) return sendJson(res, 400, { error: 'Missing newHeadlineId.' });

  try {
    const approved = await loadApproved();
    const pool = await replacePoolHeadline(poolId, index, newHeadlineId, approved);
    sendJson(res, 200, { ok: true, pool });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

async function handleBuildRounds(res) {
  const [pools, schedule, existingRounds, approved] = await Promise.all([
    loadPools(),
    loadSchedule(),
    loadRounds(),
    loadApproved(),
  ]);
  const approvedById = new Map(approved.map((a) => [a.id, a]));
  const today = todayDateString();
  const output = {};
  const warnings = [];
  let shippedCount = 0;
  let rebuiltCount = 0;
  let skippedCount = 0;

  for (const [date, poolId] of Object.entries(schedule)) {
    const roundId = dateStringToRoundId(date);
    const existing = existingRounds[roundId];
    const isShipped = date <= today && Boolean(existing);

    if (isShipped) {
      if (existing.__scheduleAtBuild !== poolId) {
        warnings.push(
          `${date} (${roundId}) has shipped and is frozen at ${existing.__scheduleAtBuild}, ` +
          `but schedule.json now points to ${poolId}. NOT applying the change.`
        );
      }
      output[roundId] = existing;
      shippedCount++;
      continue;
    }

    const pool = pools[poolId];
    if (!pool) {
      warnings.push(`${date} points to pool "${poolId}", which no longer exists — skipped.`);
      skippedCount++;
      continue;
    }

    const ratings = [];
    let missing = 0;
    for (const h of pool.headlines) {
      const record = approvedById.get(h.id);
      if (record && typeof record.difficulty === 'number') ratings.push(record.difficulty);
      else missing++;
    }
    if (missing > 0 && ratings.length > 0) {
      warnings.push(`${date}: ${missing} headline(s) missing a difficulty rating — averaged only the ${ratings.length} that have one.`);
    }
    const difficulty = ratings.length ? Math.round((ratings.reduce((s, d) => s + d, 0) / ratings.length) * 10) / 10 : null;

    output[roundId] = { id: roundId, date, headlines: pool.headlines, difficulty, __scheduleAtBuild: poolId };
    rebuiltCount++;
  }

  await saveRounds(output);
  sendJson(res, 200, { ok: true, warnings, shippedCount, rebuiltCount, skippedCount, total: Object.keys(output).length });
}

async function handleIndex(res) {
  const html = await readFile(INDEX_HTML_PATH, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/') return await handleIndex(res);
    if (req.method === 'GET' && url.pathname === '/api/pending') return await handleGetPending(res, url);
    if (req.method === 'POST' && url.pathname === '/api/decide') return await handleDecide(req, res);

    if (req.method === 'GET' && url.pathname === '/api/schedule-state') return await handleScheduleState(res);
    if (req.method === 'GET' && url.pathname === '/api/approved-headlines') return await handleApprovedHeadlines(res, url);
    if (req.method === 'POST' && url.pathname === '/api/edit-approved-text') return await handleEditApprovedText(req, res);
    if (req.method === 'POST' && url.pathname === '/api/create-pool') return await handleCreatePool(req, res);
    if (req.method === 'POST' && url.pathname === '/api/assign-day') return await handleAssignDay(req, res);
    if (req.method === 'POST' && url.pathname === '/api/unassign-day') return await handleUnassignDay(req, res);
    if (req.method === 'POST' && url.pathname === '/api/reorder-pool') return await handleReorderPool(req, res);
    if (req.method === 'POST' && url.pathname === '/api/replace-pool-headline') return await handleReplacePoolHeadline(req, res);
    if (req.method === 'POST' && url.pathname === '/api/build-rounds') return await handleBuildRounds(res);

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, 'localhost', () => {
  console.log(`Curation UI running at http://localhost:${PORT}`);
});
