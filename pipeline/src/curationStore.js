// Shared read/write logic for the curation backlog, used by both the
// interactive CLI (curate.js), the browser curation UI (curate-ui-server.js),
// and the scoring scripts (score-headlines.js / score-decades.js) — so the
// tools can never drift on the approved-record shape (design doc §4.3), and
// so concurrent read-modify-write cycles against the same raw year file
// (e.g. scoring and a manual reject landing at the same time) can't silently
// clobber one another.

import { mkdir, readFile, readdir, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RAW_DIR = new URL('../data/raw/', import.meta.url);
export const APPROVED_PATH = new URL('../data/approved.json', import.meta.url);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A cross-process lock for one raw year file. mkdir is atomic even across
// separate Node processes (two processes racing to create the same directory
// — only one wins), which a naive "check then write" can't guarantee. Used to
// wrap every read-modify-write cycle against a given year's file so scoring
// and manual curation (reject/approve) can run at the same time without one
// silently overwriting the other's change.
async function withRawFileLock(year, fn) {
  const lockPath = new URL(`.nyt_${year}.lock`, RAW_DIR);
  const lockDir = new URL(lockPath).pathname;
  const maxWaitMs = 10000;
  const pollMs = 50;
  let waited = 0;

  while (true) {
    try {
      await mkdir(lockDir);
      break; // lock acquired
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (waited >= maxWaitMs) {
        throw new Error(`Timed out waiting for lock on ${year} raw file (held by another process for over ${maxWaitMs}ms).`);
      }
      await sleep(pollMs);
      waited += pollMs;
    }
  }

  try {
    return await fn();
  } finally {
    await rmdir(lockDir).catch(() => {}); // release even if fn() threw
  }
}

// Fixed newspaper-desk vocabulary (design doc §4.2) — add sections deliberately, not per-headline.
export const SECTIONS = ['politics', 'world', 'business', 'sports', 'arts', 'science', 'opinion', 'style'];

export async function loadJson(fileUrl, fallback) {
  try {
    return JSON.parse(await readFile(fileUrl, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function listRawYears() {
  try {
    const entries = await readdir(new URL(RAW_DIR).pathname);
    return entries
      .map((name) => name.match(/^nyt_(\d{4})\.json$/))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function loadPendingForYear(year) {
  const rawPath = new URL(`nyt_${year}.json`, RAW_DIR);
  const rawRecords = await loadJson(rawPath, null);
  if (!rawRecords) {
    throw new Error(`No raw dump found for ${year}. Run fetch-nyt.js first.`);
  }

  const approved = await loadJson(APPROVED_PATH, []);
  const approvedNytIds = new Set(approved.map((a) => a.nytId).filter(Boolean));
  const pending = rawRecords.filter((r) => !approvedNytIds.has(r.nytId));

  return { rawRecords, approved, pending };
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Within one year's pending headlines, best-scored come first (unscored mixed
// in after the scored ones), with a random shuffle within each score band so
// ties aren't in raw fetch order.
function orderByScore(records) {
  const bands = new Map();
  for (const record of records) {
    const key = record.interestScore ?? 'unscored';
    if (!bands.has(key)) bands.set(key, []);
    bands.get(key).push(record);
  }
  const orderedKeys = [...bands.keys()].sort((a, b) => {
    if (a === 'unscored') return b === 'unscored' ? 0 : 1;
    if (b === 'unscored') return -1;
    return b - a;
  });
  return orderedKeys.flatMap((key) => shuffle(bands.get(key)));
}

// Pulls pending headlines from every fetched year, drops anything the local
// LLM pre-scorer (score-headlines.js) flagged as clearly bad (`autoRejected`
// or `manualRejected`), and orders what's left by interestScore descending —
// globally across all years, not just within one year — so the best
// candidates always surface first. Year variety is only a side effect of
// shuffling within each score tier (all the 5s in random order, then all the
// 4s, etc.), not a deliberate goal: score ordering takes priority.
//
// scoredOnly (default true): only headlines score-headlines.js has actually
// scored and passed are included — unscored raw headlines never silently
// fill the queue. This keeps "what's up for review" meaning what the LLM has
// vetted, and lets the caller detect "nothing scored yet" as its own state
// (pendingCount 0 while unscoredCount > 0) rather than that queue quietly
// being backfilled with un-vetted headlines.
//
// yearMin/yearMax: inclusive publication-year bounds. sections: an array of
// SECTIONS values — a record passes if its suggestedSection is in the list
// (an unscored/unsuggested record has no section yet, so it only passes when
// no section filter is applied, matching "nothing to filter out for it yet"
// rather than guessing a section for it).
//
// These filters only narrow what counts as `pending` — the various *Count
// totals (autoRejectedCount etc.) stay dataset-wide, not filtered, since
// they describe overall backlog health rather than "matches of this view."
export async function loadPendingAcrossYears({ scoredOnly = true, yearMin = null, yearMax = null, sections = null } = {}) {
  const years = await listRawYears();
  const approved = await loadJson(APPROVED_PATH, []);
  const approvedNytIds = new Set(approved.map((a) => a.nytId).filter(Boolean));

  let total = 0;
  let autoRejectedCount = 0;
  let manualRejectedCount = 0;
  let unscoredCount = 0;
  let allPending = [];
  for (const year of years) {
    const rawRecords = await loadJson(new URL(`nyt_${year}.json`, RAW_DIR), []);
    total += rawRecords.length;
    for (const r of rawRecords) {
      if (approvedNytIds.has(r.nytId)) continue;
      if (r.manualRejected) {
        manualRejectedCount++;
        continue;
      }
      if (r.autoRejected) {
        autoRejectedCount++;
        continue;
      }
      if (r.interestScore == null) {
        unscoredCount++;
        if (scoredOnly) continue;
      }

      if (yearMin != null || yearMax != null) {
        const recordYear = yearFromPubDate(r.pubDate);
        if (recordYear == null) continue;
        if (yearMin != null && recordYear < yearMin) continue;
        if (yearMax != null && recordYear > yearMax) continue;
      }

      if (sections && sections.length && !sections.includes(r.suggestedSection)) continue;

      allPending.push(r);
    }
  }

  const pending = orderByScore(allPending);

  const approvedBySection = {};
  for (const s of SECTIONS) approvedBySection[s] = 0;
  const approvedByDecade = {};
  for (const a of approved) {
    if (a.section) approvedBySection[a.section] = (approvedBySection[a.section] ?? 0) + 1;
    if (a.year != null) {
      const decade = `${Math.floor(a.year / 10) * 10}s`;
      approvedByDecade[decade] = (approvedByDecade[decade] ?? 0) + 1;
    }
  }

  return { years, total, approved, autoRejectedCount, manualRejectedCount, unscoredCount, pending, approvedBySection, approvedByDecade };
}

export function yearFromPubDate(pubDate) {
  const year = Number(String(pubDate).slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function makeApprovedId(record, year) {
  const datePart = String(record.pubDate).slice(0, 10) || `${year}-00-00`;
  const shortId = record.nytId?.split('/').pop()?.slice(-6) ?? Math.random().toString(36).slice(2, 8);
  return `nyt-${datePart}-${shortId}`;
}

export function isValidDifficulty(difficulty) {
  return Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 5;
}

export function buildApprovedRecord(record, { difficulty, section }) {
  const year = yearFromPubDate(record.pubDate);
  if (!year) throw new Error('Could not parse a year from pubDate.');
  if (!isValidDifficulty(difficulty)) throw new Error('Difficulty must be an integer 1-5.');
  if (!SECTIONS.includes(section)) throw new Error(`Section must be one of: ${SECTIONS.join(', ')}`);

  return {
    id: makeApprovedId(record, year),
    source: 'nyt',
    nytId: record.nytId,
    text: record.text,
    year,
    section,
    sourceUrl: record.sourceUrl,
    difficulty,
    usedInRounds: [],
    avgGuessError: null,
  };
}

export async function appendApproved(approved, newRecord) {
  approved.push(newRecord);
  await mkdir(path.dirname(new URL(APPROVED_PATH).pathname), { recursive: true });
  await writeFile(APPROVED_PATH, JSON.stringify(approved, null, 2));
  return approved;
}

// Persists a manual "Reject" decision onto the raw record so it never
// resurfaces after a refresh/restart — unlike Skip, which is intentionally
// session-local (queue order only) so a headline can be revisited later.
// Locked because score-decades.js may be rewriting the same year's file
// concurrently in the background (see withRawFileLock).
export async function markManualRejected(nytId, year) {
  return withRawFileLock(year, async () => {
    const rawPath = new URL(`nyt_${year}.json`, RAW_DIR);
    const records = await loadJson(rawPath, null);
    if (!records) throw new Error(`No raw dump found for ${year}.`);

    const record = records.find((r) => r.nytId === nytId);
    if (!record) throw new Error(`No record with nytId ${nytId} found in ${year}.`);

    record.manualRejected = true;
    await writeFile(rawPath, JSON.stringify(records, null, 2));
    return record;
  });
}

export { withRawFileLock };
