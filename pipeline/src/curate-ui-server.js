// Local-only browser UI for curation — same underlying read/write logic as
// curate.js (see curationStore.js), just a nicer front end for review/rate/tag.
// Not part of the shipped game; this process only ever binds to localhost.
//
// Usage: node src/curate-ui-server.js [port]   (default port 5177)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { SECTIONS, appendApproved, buildApprovedRecord, loadJson, loadPendingAcrossYears, markManualRejected, yearFromPubDate, APPROVED_PATH } from './curationStore.js';

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

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, 'localhost', () => {
  console.log(`Curation UI running at http://localhost:${PORT}`);
});
