// Day boundary is fixed at midnight UTC (design doc §5/§11) so the scheduler
// and the game agree on what "today" means without relying on server-local time.
// This file is intentionally duplicated in game/src/dateUtils.js rather than
// shared via a package — see implementation notes.

export function todayDateString(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

export function dateStringToRoundId(dateString) {
  return `round-${dateString}`;
}
