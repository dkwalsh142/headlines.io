// Completed-issue scores, persisted to localStorage so they survive reloads.
// One entry per issue: replaying an issue (allowed for now) overwrites it
// with the newest score. Stored as
//   { [roundId]: { total, date, playedAt, firstPlayedAt,
//                  results: [{ headlineId, section, guessYear, year, points }] } }
// — `date` is the issue's own date and `firstPlayedAt` survives replays, so
// stats.js can tell whether an issue was played on its day (for streaks).
// Entries saved before stats existed have only { total, playedAt }.
//
// Per-browser only (like settings): cleared site data, private windows, and
// other devices won't see it. Same-day comparison across players needs the
// planned stats backend.

const STORAGE_KEY = 'headlines.scores';

function loadAll() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

// roundId -> latest total score
export function loadScores() {
  const all = loadAll();
  const totals = {};
  for (const [roundId, entry] of Object.entries(all)) {
    if (Number.isFinite(entry?.total)) totals[roundId] = entry.total;
  }
  return totals;
}

// Every saved entry, for the Stats page.
export function loadScoreEntries() {
  return loadAll();
}

export function saveScore(roundId, total, { date, results } = {}) {
  try {
    const all = loadAll();
    const now = new Date().toISOString();
    const previous = all[roundId];
    all[roundId] = {
      total,
      date,
      playedAt: now,
      firstPlayedAt: previous?.firstPlayedAt ?? previous?.playedAt ?? now,
      results,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the score still shows for this session (App
    // state), it just won't be remembered.
  }
}

// Dev tool (beta panel): forget every saved score.
export function clearScores() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to clear.
  }
}
