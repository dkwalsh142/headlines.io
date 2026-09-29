// Read-only review tooling for round scheduling (round scheduling design doc
// §5.3). Two sections of output: unassigned pools (catalogue not yet on the
// schedule) and the schedule itself, sorted chronologically — both with
// headline titles/sections looked up from approved.json for sanity-checking
// before build-rounds.js runs.
//
// Usage: node src/review-schedule.js

import { assignedPoolIds, loadApproved, loadPools, loadSchedule } from './poolStore.js';

function describeHeadline(approvedById, headline) {
  const record = approvedById.get(headline.id);
  const title = record ? record.text : '(not found in approved.json)';
  const section = headline.section ?? record?.section ?? 'unknown';
  return `    - [${section}] ${title} (${headline.id})`;
}

async function main() {
  const [pools, schedule, approved] = await Promise.all([loadPools(), loadSchedule(), loadApproved()]);
  const approvedById = new Map(approved.map((a) => [a.id, a]));
  const assigned = assignedPoolIds(schedule);

  console.log('=== Unassigned pools ===\n');
  const unassignedIds = Object.keys(pools)
    .filter((id) => !assigned.has(id))
    .sort();
  if (!unassignedIds.length) {
    console.log('  (none)');
  } else {
    for (const id of unassignedIds) {
      const pool = pools[id];
      console.log(`  ${id}  (created ${pool.createdAt})`);
      for (const h of pool.headlines) console.log(describeHeadline(approvedById, h));
    }
  }

  console.log('\n=== Schedule ===\n');
  const dates = Object.keys(schedule).sort();
  if (!dates.length) {
    console.log('  (none)');
  } else {
    for (const date of dates) {
      const poolId = schedule[date];
      const pool = pools[poolId];
      console.log(`  ${date}  ->  ${poolId}${pool ? '' : '  [MISSING FROM round-pool.json]'}`);
      if (pool) {
        for (const h of pool.headlines) console.log(describeHeadline(approvedById, h));
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
