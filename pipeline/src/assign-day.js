// Phase 2 of round scheduling (round scheduling design doc §5.2): assign a
// pool id to a calendar date in schedule.json, or unassign a date. Warn,
// never block.
//
// NOTE: design-doc.md §5 requires September 11 to never carry a normal
// guessing round. That constraint is not yet enforced here — deferred, not
// dropped. Revisit before this is used to schedule real dates.
//
// Usage:
//   node src/assign-day.js <YYYY-MM-DD> <poolId>   — assign (overwrites if already set)
//   node src/assign-day.js --unassign <YYYY-MM-DD> — remove any assignment for that date

import { loadPools, loadSchedule, saveSchedule } from './poolStore.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function poolHeadlineIds(pool) {
  return new Set((pool?.headlines ?? []).map((h) => h.id));
}

async function assign(date, poolId) {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD.`);
  }

  const [pools, schedule] = await Promise.all([loadPools(), loadSchedule()]);

  if (schedule[date]) {
    console.warn(`WARNING: ${date} already assigned to ${schedule[date]} — overwriting with ${poolId}.`);
  }

  const pool = pools[poolId];
  if (!pool) {
    console.warn(`WARNING: pool id "${poolId}" not found in round-pool.json — assigning anyway.`);
  }

  // Cooldown: for each headline in the pool being assigned, scan schedule.json
  // for any OTHER date whose pool also contains that headline id.
  if (pool) {
    const ids = poolHeadlineIds(pool);
    for (const headlineId of ids) {
      const clashDates = [];
      for (const [otherDate, otherPoolId] of Object.entries(schedule)) {
        if (otherDate === date) continue;
        const otherPool = pools[otherPoolId];
        if (!otherPool) continue;
        if (poolHeadlineIds(otherPool).has(headlineId)) clashDates.push(otherDate);
      }
      if (clashDates.length) {
        console.warn(`WARNING: headline "${headlineId}" also appears on ${clashDates.join(', ')} — cooldown clash.`);
      }
    }
  }

  schedule[date] = poolId;
  await saveSchedule(schedule);
  console.log(`Assigned ${date} -> ${poolId}.`);
}

async function unassign(date) {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD.`);
  }

  const schedule = await loadSchedule();
  if (!schedule[date]) {
    console.warn(`WARNING: ${date} was not assigned — nothing to unassign.`);
    return;
  }
  const removedPoolId = schedule[date];
  delete schedule[date];
  await saveSchedule(schedule);
  console.log(`Unassigned ${date} (was ${removedPoolId}).`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--unassign') {
    const date = args[1];
    if (!date) throw new Error('Usage: node src/assign-day.js --unassign <YYYY-MM-DD>');
    await unassign(date);
    return;
  }

  const [date, poolId] = args;
  if (!date || !poolId) {
    throw new Error('Usage: node src/assign-day.js <YYYY-MM-DD> <poolId>\n   or: node src/assign-day.js --unassign <YYYY-MM-DD>');
  }
  await assign(date, poolId);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
