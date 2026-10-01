// Personal stats, computed from the player's saved scores (scoreStore.js).
// Pure functions: everything is derived on demand, nothing extra is stored.
//
// Counts each issue once, by its latest play (replays overwrite scores).
// Per-headline breakdowns (section, decade, accuracy) only cover issues saved
// since per-headline results were recorded; older entries still count
// toward played / average / best / streaks.

import { SECTION_LABEL } from './sections.js';

function issueDate(roundId, entry) {
  return entry.date ?? roundId.replace(/^round-/, '');
}

// "YYYY-MM-DD" -> day number, for consecutive-day checks (UTC, matching the
// game's midnight-UTC day boundary).
function dayNumber(date) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

function average(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function breakdown(results, keyOf, labelOf, order) {
  const groups = new Map();
  for (const r of results) {
    const key = keyOf(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()]
    .map(([key, rs]) => ({
      key,
      label: labelOf(key),
      count: rs.length,
      avgPoints: average(rs.map((r) => r.points)),
      avgMiss: average(rs.map((r) => Math.abs(r.guessYear - r.year))),
    }))
    .sort(order);
}

export function computeStats(entries, today) {
  const issues = Object.entries(entries)
    .filter(([, e]) => Number.isFinite(e?.total))
    .map(([roundId, e]) => ({ roundId, ...e, date: issueDate(roundId, e) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!issues.length) return null;

  const totals = issues.map((i) => i.total);
  const best = issues.reduce((a, b) => (b.total > a.total ? b : a));

  // Streaks: consecutive days on which the player finished that day's issue
  // on the day itself (playing an old issue later doesn't count). The
  // current streak stays alive through today until today's issue is played.
  const onDay = new Set(
    issues
      .filter((i) => (i.firstPlayedAt ?? i.playedAt ?? '').slice(0, 10) === i.date)
      .map((i) => dayNumber(i.date))
  );
  let longestStreak = 0;
  for (const d of onDay) {
    if (onDay.has(d - 1)) continue; // not the start of a run
    let len = 1;
    while (onDay.has(d + len)) len++;
    longestStreak = Math.max(longestStreak, len);
  }
  const todayN = dayNumber(today);
  let currentStreak = 0;
  for (let d = onDay.has(todayN) ? todayN : todayN - 1; onDay.has(d); d--) currentStreak++;

  const results = issues.flatMap((i) => i.results ?? []);
  const sectionOrder = Object.keys(SECTION_LABEL);
  const bySection = breakdown(
    results,
    (r) => r.section,
    (key) => SECTION_LABEL[key] ?? key,
    (a, b) => sectionOrder.indexOf(a.key) - sectionOrder.indexOf(b.key)
  );
  // By the decade the headline actually ran in (1900s, 1910s, ...).
  const byDecade = breakdown(
    results,
    (r) => Math.floor(r.year / 10) * 10,
    (decade) => `${decade}s`,
    (a, b) => a.key - b.key
  );

  return {
    played: issues.length,
    averageScore: average(totals),
    best: { total: best.total, date: best.date },
    currentStreak,
    longestStreak,
    avgMiss: average(results.map((r) => Math.abs(r.guessYear - r.year))),
    exactGuesses: results.filter((r) => r.guessYear === r.year).length,
    bySection,
    byDecade,
    recent: issues.slice(-7).reverse().map((i) => ({ date: i.date, total: i.total })),
  };
}
