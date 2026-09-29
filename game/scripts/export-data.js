// Copies rounds.json + the headline records it references from the pipeline
// into game/public/data/, so the app can fetch them as static JSON with no
// backend involved in loading a round (design doc §6.1). Only ships the
// headlines actually used by a round, not the full approved.json backlog.
//
// Usage: node scripts/export-data.js

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_DATA = path.join(__dirname, '../../pipeline/data');
const OUT_DIR = path.join(__dirname, '../public/data');

const rounds = JSON.parse(readFileSync(path.join(PIPELINE_DATA, 'rounds.json'), 'utf-8'));
const approved = JSON.parse(readFileSync(path.join(PIPELINE_DATA, 'approved.json'), 'utf-8'));

const usedIds = new Set();
for (const round of Object.values(rounds)) {
  for (const h of round.headlines) usedIds.add(h.id);
}

const headlinesById = {};
const missing = [];
for (const id of usedIds) {
  const record = approved.find((a) => a.id === id);
  if (record) headlinesById[id] = record;
  else missing.push(id);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'rounds.json'), JSON.stringify(rounds, null, 2));
writeFileSync(path.join(OUT_DIR, 'headlines.json'), JSON.stringify(headlinesById, null, 2));

if (missing.length) {
  console.warn(`WARNING: ${missing.length} headline id(s) referenced by rounds.json but not found in approved.json:`, missing);
}
console.log(`Exported ${Object.keys(rounds).length} round(s), ${Object.keys(headlinesById).length} headline(s) to public/data/.`);
