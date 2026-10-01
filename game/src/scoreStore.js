// Completed-issue scores, persisted to localStorage so they survive reloads.
// One entry per issue: replaying an issue (allowed for now) overwrites it
// with the newest score. Stored as { [roundId]: { total, playedAt } } so a
// play date is on hand if we later want history or streaks.
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

export function saveScore(roundId, total) {
  try {
    const all = loadAll();
    all[roundId] = { total, playedAt: new Date().toISOString() };
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
