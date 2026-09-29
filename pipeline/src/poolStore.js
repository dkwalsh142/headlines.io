// Shared read/write logic for the round-scheduling subsystem (round scheduling
// design doc §3-4): round-pool.json (headline groups, no dates), schedule.json
// (date -> pool id), and rounds.json (generated join of the two). Used by
// create-pool.js, assign-day.js, review-schedule.js, and build-rounds.js so
// none of them can drift on file paths or the pool/schedule shapes.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const POOL_PATH = new URL('../data/round-pool.json', import.meta.url);
export const SCHEDULE_PATH = new URL('../data/schedule.json', import.meta.url);
export const ROUNDS_PATH = new URL('../data/rounds.json', import.meta.url);
export const APPROVED_PATH = new URL('../data/approved.json', import.meta.url);

export async function loadJson(fileUrl, fallback) {
  try {
    return JSON.parse(await readFile(fileUrl, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(fileUrl, data) {
  await mkdir(path.dirname(new URL(fileUrl).pathname), { recursive: true });
  await writeFile(fileUrl, JSON.stringify(data, null, 2) + '\n');
}

export async function loadPools() {
  return loadJson(POOL_PATH, {});
}

export async function savePools(pools) {
  await writeJson(POOL_PATH, pools);
}

export async function loadSchedule() {
  return loadJson(SCHEDULE_PATH, {});
}

export async function saveSchedule(schedule) {
  await writeJson(SCHEDULE_PATH, schedule);
}

export async function loadRounds() {
  return loadJson(ROUNDS_PATH, {});
}

export async function saveRounds(rounds) {
  await writeJson(ROUNDS_PATH, rounds);
}

export async function loadApproved() {
  return loadJson(APPROVED_PATH, []);
}

export function nextPoolId(pools) {
  let max = 0;
  for (const id of Object.keys(pools)) {
    const m = id.match(/^pool-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `pool-${String(max + 1).padStart(4, '0')}`;
}

// A pool is "assigned" iff its id appears as a value anywhere in schedule.json
// (round scheduling doc §4.1) — never stored as a field on the pool itself.
export function assignedPoolIds(schedule) {
  return new Set(Object.values(schedule));
}

// Reorders an already-created pool's headlines in place. Array order IS play
// order (§4.1 — no separate `position` field), so this is the one thing about
// a pool that's still worth editing after creation. Does not touch
// schedule.json or rounds.json — if the pool is assigned to a not-yet-shipped
// date, build-rounds.js picks up the new order on its next run same as any
// other pool edit; a shipped date stays frozen per its existing freeze rule.
export async function reorderPoolHeadlines(poolId, orderedIds) {
  const pools = await loadPools();
  const pool = pools[poolId];
  if (!pool) throw new Error(`No pool with id ${poolId}.`);

  const byId = new Map(pool.headlines.map((h) => [h.id, h]));
  if (orderedIds.length !== pool.headlines.length || !orderedIds.every((id) => byId.has(id))) {
    throw new Error('orderedIds must be a permutation of the pool\'s existing headline ids.');
  }

  pool.headlines = orderedIds.map((id) => byId.get(id));
  await savePools(pools);
  return pool;
}

// Swaps a single headline in an already-created pool for a different one,
// leaving the other 4 (and their positions) untouched — for "I want to
// change one out but not the other." Position is preserved so a reorder
// done before the swap isn't undone by it.
export async function replacePoolHeadline(poolId, index, newHeadlineId, approved) {
  const pools = await loadPools();
  const pool = pools[poolId];
  if (!pool) throw new Error(`No pool with id ${poolId}.`);
  if (!Number.isInteger(index) || index < 0 || index >= pool.headlines.length) {
    throw new Error(`Invalid index ${index} for a pool with ${pool.headlines.length} headline(s).`);
  }
  if (pool.headlines.some((h, i) => i !== index && h.id === newHeadlineId)) {
    throw new Error('That headline is already in this pool.');
  }

  const record = approved.find((a) => a.id === newHeadlineId);
  pool.headlines[index] = record ? { id: newHeadlineId, section: record.section } : { id: newHeadlineId, section: null };

  await savePools(pools);
  return pool;
}
