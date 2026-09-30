// Copies rounds.json + the headline records it references from the pipeline
// into game/public/data/, so the app can fetch them as static JSON with no
// backend involved in loading a round (design doc §6.1). Only ships the
// headlines actually used by a round, not the full approved.json backlog.
//
// The shipped data is stripped so answers can't be read straight out of the
// Network tab: each headline gets an opaque id (the pipeline's ids embed the
// publication date), only the fields the game displays are kept, and the
// year + archive link travel as one obfuscated `answer` string that the game
// decodes at reveal time (see src/answerCodec.js — a deterrent, not
// security). Per-headline stats (difficulty, avgGuessError) are dropped too,
// since they hint at the answer.
//
// Usage: node scripts/export-data.js

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encodeAnswer } from '../src/answerCodec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_DATA = path.join(__dirname, '../../pipeline/data');
const OUT_DIR = path.join(__dirname, '../public/data');

const rounds = JSON.parse(readFileSync(path.join(PIPELINE_DATA, 'rounds.json'), 'utf-8'));
const approved = JSON.parse(readFileSync(path.join(PIPELINE_DATA, 'approved.json'), 'utf-8'));

const usedIds = new Set();
for (const round of Object.values(rounds)) {
  for (const h of round.headlines) usedIds.add(h.id);
}

// Deterministic, so a headline keeps the same public id across exports
// (the game seeds its filler text from it), but reveals nothing about the
// pipeline id it came from.
const publicId = (id) => 'h-' + createHash('sha256').update(`headlines.io/id/v1:${id}`).digest('base64url').slice(0, 12);

const headlinesById = {};
const missing = [];
for (const id of usedIds) {
  const record = approved.find((a) => a.id === id);
  if (!record) {
    missing.push(id);
    continue;
  }
  const pid = publicId(id);
  headlinesById[pid] = {
    id: pid,
    text: record.text,
    section: record.section,
    answer: encodeAnswer(pid, { year: record.year, sourceUrl: record.sourceUrl }),
  };
}

// Rounds keep only what the game uses, with headline ids swapped for public ones.
const publicRounds = {};
for (const [key, round] of Object.entries(rounds)) {
  publicRounds[key] = {
    id: round.id,
    date: round.date,
    difficulty: round.difficulty,
    headlines: round.headlines
      .filter((h) => !missing.includes(h.id))
      .map((h) => ({ id: publicId(h.id), section: h.section })),
  };
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, 'rounds.json'), JSON.stringify(publicRounds, null, 2));
writeFileSync(path.join(OUT_DIR, 'headlines.json'), JSON.stringify(headlinesById, null, 2));

if (missing.length) {
  console.warn(`WARNING: ${missing.length} headline id(s) referenced by rounds.json but not found in approved.json:`, missing);
}
console.log(`Exported ${Object.keys(rounds).length} round(s), ${Object.keys(headlinesById).length} headline(s) to public/data/.`);
