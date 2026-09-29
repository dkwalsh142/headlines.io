// Join step for round scheduling (round scheduling design doc §5.4): produces
// rounds.json from round-pool.json + schedule.json. Safe to re-run at any
// time, except it must never modify a date that has already shipped.
//
// Freeze rule: a date is "shipped" if date <= today (UTC, per dateUtils.js's
// fixed day boundary) AND rounds.json already has an entry for that date from
// a prior build. Shipped dates are carried forward untouched — headlines,
// order, and difficulty all stay exactly as they were — even if schedule.json
// has since been repointed to a different pool (detected via
// __scheduleAtBuild mismatch -> warn loudly, do not apply) or a headline's
// difficulty in approved.json has since changed (not recalculated for
// shipped rounds).
//
// Dates that are today-or-future and not yet in rounds.json rebuild freely
// from current data every run.
//
// NOTE: design-doc.md §5 requires September 11 to never carry a normal
// guessing round. That constraint is not yet enforced here — deferred, not
// dropped. Revisit before this is used to build real schedules.
//
// Usage: node src/build-rounds.js

import { dateStringToRoundId, todayDateString } from './dateUtils.js';
import { loadApproved, loadPools, loadRounds, loadSchedule, saveRounds } from './poolStore.js';

function computeDifficulty(headlines, approvedById) {
  const ratings = [];
  let missing = 0;
  for (const h of headlines) {
    const record = approvedById.get(h.id);
    if (record && typeof record.difficulty === 'number') {
      ratings.push(record.difficulty);
    } else {
      missing++;
    }
  }
  if (missing > 0 && ratings.length > 0) {
    console.warn(`  WARNING: ${missing} headline(s) missing a difficulty rating — averaging only the ${ratings.length} that have one.`);
  }
  if (!ratings.length) return null;
  const avg = ratings.reduce((sum, d) => sum + d, 0) / ratings.length;
  return Math.round(avg * 10) / 10;
}

async function main() {
  const [pools, schedule, existingRounds, approved] = await Promise.all([
    loadPools(),
    loadSchedule(),
    loadRounds(),
    loadApproved(),
  ]);
  const approvedById = new Map(approved.map((a) => [a.id, a]));

  const today = todayDateString();
  const output = {};
  let shippedCount = 0;
  let rebuiltCount = 0;
  let skippedCount = 0;

  for (const [date, poolId] of Object.entries(schedule)) {
    const roundId = dateStringToRoundId(date);
    const existing = existingRounds[roundId];
    const isPast = date <= today;
    const isShipped = isPast && existing;

    if (isShipped) {
      // Frozen: carry forward untouched, regardless of schedule/difficulty drift.
      if (existing.__scheduleAtBuild !== poolId) {
        console.warn(
          `WARNING: ${date} (${roundId}) has shipped and is frozen at ${existing.__scheduleAtBuild}, ` +
          `but schedule.json now points to ${poolId}. NOT applying the change — the shipped round stays as-is.`
        );
      }
      output[roundId] = existing;
      shippedCount++;
      continue;
    }

    // Not yet shipped — rebuilds freely from current data.
    const pool = pools[poolId];
    if (!pool) {
      console.warn(`WARNING: ${date} points to pool "${poolId}", which no longer exists in round-pool.json — skipping this date.`);
      skippedCount++;
      continue;
    }

    console.log(`Building ${roundId} from ${poolId}...`);
    const difficulty = computeDifficulty(pool.headlines, approvedById);

    output[roundId] = {
      id: roundId,
      date,
      headlines: pool.headlines,
      difficulty,
      __scheduleAtBuild: poolId,
    };
    rebuiltCount++;
  }

  await saveRounds(output);

  console.log(
    `\nDone. ${shippedCount} shipped round(s) carried forward untouched, ` +
    `${rebuiltCount} round(s) built/rebuilt, ${skippedCount} date(s) skipped. ` +
    `rounds.json now has ${Object.keys(output).length} entries.`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
