// Distance-based decay (design doc §6.3): max points at the exact year,
// falling off exponentially with |guess - actual|. Tuned to this backlog's
// ~125-year span (1901-2026) — half credit at a 10-year miss, negligible
// credit past a 50-year miss, so a guess anywhere in the right decade still
// feels rewarded but a wild guess across eras scores close to nothing.
const MAX_POINTS = 1000;
const HALF_LIFE_YEARS = 10;

export function scoreGuess(guessYear, actualYear) {
  const distance = Math.abs(guessYear - actualYear);
  const points = MAX_POINTS * Math.pow(0.5, distance / HALF_LIFE_YEARS);
  return Math.round(points);
}
