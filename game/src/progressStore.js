// In-progress issues, persisted to localStorage so a player who exits mid-
// issue (or reloads) picks up where they left off. One entry per issue:
//   { [roundId]: { index, results: [{ headlineId, guessYear, year, sourceUrl, points }] } }
// `index` is the headline on screen; if results has an entry for it, the
// player had already guessed it and is resumed on that headline's reveal.
// Cleared when the issue is finished (its score lives in scoreStore.js).
//
// Stored years are only ever for headlines the player has already guessed,
// so this doesn't leak upcoming answers.

const STORAGE_KEY = 'headlines.progress';

function loadAll() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

function saveAll(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: progress just won't survive leaving the issue.
  }
}

export function loadProgress(roundId) {
  return loadAll()[roundId] ?? null;
}

export function saveProgress(roundId, progress) {
  const all = loadAll();
  all[roundId] = progress;
  saveAll(all);
}

export function clearProgress(roundId) {
  const all = loadAll();
  if (!(roundId in all)) return;
  delete all[roundId];
  saveAll(all);
}

// Ids of every issue with saved progress, for "Resume" labels.
export function loadProgressIds() {
  return new Set(Object.keys(loadAll()));
}

// Dev tool (beta panel reset).
export function clearAllProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to clear.
  }
}
