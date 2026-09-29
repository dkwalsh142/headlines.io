// Phase 1 of round scheduling (round scheduling design doc §5.1): group 5
// headline ids into a reusable, dateless "round pool" entry. Auto-assigns the
// next sequential pool id. Most checks below are advisory (curator mistakes,
// not enforced) — they print a warning and continue. The one exception:
// headline count is a hard block, exactly 5, always — every round must be
// exactly 5 headlines, so this can't be fudged from the CLI either.
//
// Play order = array order (curator sequences deliberately; no `position` field).
//
// Usage: node src/create-pool.js <headlineId1> <headlineId2> ... <headlineId5>

import { loadApproved, loadPools, nextPoolId, savePools } from './poolStore.js';

function yearFromApprovedId(id) {
  const m = String(id).match(/^nyt-(\d{4})-/);
  return m ? Number(m[1]) : null;
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length !== 5) {
    throw new Error(`A pool must have exactly 5 headlines (got ${ids.length}).\nUsage: node src/create-pool.js <headlineId1> <headlineId2> ... <headlineId5>`);
  }

  const approved = await loadApproved();
  const approvedById = new Map(approved.map((a) => [a.id, a]));

  const headlines = ids.map((id) => {
    const record = approvedById.get(id);
    if (!record) {
      console.warn(`WARNING: headline id "${id}" not found in approved.json — storing as-is with section: null.`);
      return { id, section: null };
    }
    return { id, section: record.section };
  });

  const sections = new Set(headlines.map((h) => h.section));
  if (headlines.length > 1 && sections.size === 1) {
    console.warn(`WARNING: all ${headlines.length} headlines share the same section ("${[...sections][0]}") — no variety.`);
  }

  const decadeCounts = new Map();
  for (const id of ids) {
    const year = yearFromApprovedId(id);
    if (year == null) continue;
    const decade = Math.floor(year / 10) * 10;
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
  }
  const repeatedDecades = [...decadeCounts.entries()].filter(([, count]) => count > 1);
  if (repeatedDecades.length) {
    const desc = repeatedDecades.map(([decade, count]) => `${decade}s (${count})`).join(', ');
    console.warn(`WARNING: two or more headlines fall in the same decade: ${desc}.`);
  }

  const pools = await loadPools();
  const id = nextPoolId(pools);
  const pool = {
    id,
    createdAt: new Date().toISOString(),
    headlines,
  };
  pools[id] = pool;
  await savePools(pools);

  console.log(`Created ${id} with ${headlines.length} headline(s).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
