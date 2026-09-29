// Loads rounds.json + headlines.json as static JSON (design doc §6.1 — no
// backend involved in loading a round) and resolves each round's headline
// ids into full records for rendering.

import { dateStringToRoundId, todayDateString } from './dateUtils.js';

export async function loadGameData() {
  const [roundsRes, headlinesRes] = await Promise.all([
    fetch('/data/rounds.json'),
    fetch('/data/headlines.json'),
  ]);
  if (!roundsRes.ok || !headlinesRes.ok) {
    throw new Error('Failed to load round data.');
  }
  const rounds = await roundsRes.json();
  const headlinesById = await headlinesRes.json();

  const resolveRound = (round) => ({
    ...round,
    headlines: round.headlines.map((h) => {
      const record = headlinesById[h.id];
      return record ? { ...record, section: h.section ?? record.section } : null;
    }).filter(Boolean),
  });

  const allRounds = Object.values(rounds)
    .map(resolveRound)
    .sort((a, b) => a.date.localeCompare(b.date));

  const todayRoundId = dateStringToRoundId(todayDateString());
  const todayRound = rounds[todayRoundId] ? resolveRound(rounds[todayRoundId]) : null;

  return { allRounds, todayRound };
}
