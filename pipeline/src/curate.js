// Local interactive CLI: shows one raw headline at a time from data/raw/,
// lets you reject junk/duplicates, rate difficulty, and tag a section, all in
// one pass (design doc §4.2). Approved items are appended to data/approved.json.
//
// Usage: node src/curate.js <year>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import readline from 'node:readline';
import path from 'node:path';

const RAW_DIR = new URL('../data/raw/', import.meta.url);
const APPROVED_PATH = new URL('../data/approved.json', import.meta.url);

// Fixed newspaper-desk vocabulary (design doc §4.2) — add sections deliberately, not per-headline.
const SECTIONS = ['politics', 'world', 'business', 'sports', 'arts', 'science', 'opinion', 'style'];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

let stdinClosed = false;
rl.on('close', () => {
  stdinClosed = true;
});

// If stdin closes (Ctrl+D, or EOF on redirected input) while a question is
// pending, readline abandons the callback rather than invoking it — treat
// that the same as the user typing "q".
function ask(question) {
  if (stdinClosed) return Promise.resolve('q');
  return new Promise((resolve) => {
    const onClose = () => resolve('q');
    const settle = (value) => {
      rl.off('close', onClose);
      resolve(value);
    };
    rl.once('close', onClose);
    try {
      rl.question(question, settle);
    } catch (err) {
      if (err.code === 'ERR_USE_AFTER_CLOSE') {
        stdinClosed = true;
        settle('q');
        return;
      }
      throw err;
    }
  });
}

async function loadJson(fileUrl, fallback) {
  try {
    return JSON.parse(await readFile(fileUrl, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function yearFromPubDate(pubDate) {
  const year = Number(String(pubDate).slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function makeApprovedId(record, year) {
  const datePart = String(record.pubDate).slice(0, 10) || `${year}-00-00`;
  const shortId = record.nytId?.split('/').pop()?.slice(-6) ?? Math.random().toString(36).slice(2, 8);
  return `nyt-${datePart}-${shortId}`;
}

async function main() {
  const year = process.argv[2];
  if (!year) {
    throw new Error('Usage: node src/curate.js <year>');
  }

  const rawPath = new URL(`nyt_${year}.json`, RAW_DIR);
  const rawRecords = await loadJson(rawPath, null);
  if (!rawRecords) {
    throw new Error(`No raw dump found for ${year}. Run fetch-nyt.js first.`);
  }

  const approved = await loadJson(APPROVED_PATH, []);
  const approvedNytIds = new Set(approved.map((a) => a.nytId).filter(Boolean));
  const pending = rawRecords.filter((r) => !approvedNytIds.has(r.nytId));

  console.log(`${pending.length} headlines to review for ${year} (${rawRecords.length - pending.length} already curated).\n`);
  console.log('Commands: [a]pprove, [r]eject, [s]kip, [q]uit\n');

  let reviewed = 0;
  for (const record of pending) {
    console.log('---');
    console.log(`"${record.text}"`);
    console.log(`  ${record.pubDate}  ·  ${record.section ?? 'unknown section'}  ·  ${record.sourceUrl}`);

    const action = (await ask('  a/r/s/q > ')).trim().toLowerCase();
    if (action === 'q') break;
    if (action !== 'a') {
      reviewed++;
      continue; // reject or skip: don't add to approved.json
    }

    const year = yearFromPubDate(record.pubDate);
    if (!year) {
      console.log('  Could not parse a year from pubDate — skipping.');
      continue;
    }

    const difficultyRaw = await ask(`  difficulty 1-5 > `);
    if (difficultyRaw === 'q' && stdinClosed) break;
    const difficulty = Number(difficultyRaw);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      console.log('  Invalid difficulty — skipping this headline.');
      continue;
    }

    const sectionRaw = (await ask(`  section (${SECTIONS.join('/')}) > `)).trim().toLowerCase();
    if (sectionRaw === 'q' && stdinClosed) break;
    if (!SECTIONS.includes(sectionRaw)) {
      console.log('  Invalid section — skipping this headline.');
      continue;
    }

    approved.push({
      id: makeApprovedId(record, year),
      source: 'nyt',
      nytId: record.nytId,
      text: record.text,
      year,
      section: sectionRaw,
      sourceUrl: record.sourceUrl,
      difficulty,
      usedInRounds: [],
      avgGuessError: null,
    });

    reviewed++;
    // Persist after every approval so progress is never lost mid-session.
    await mkdir(path.dirname(new URL(APPROVED_PATH).pathname), { recursive: true });
    await writeFile(APPROVED_PATH, JSON.stringify(approved, null, 2));
  }

  console.log(`\nReviewed ${reviewed}/${pending.length}. Approved backlog now has ${approved.length} headlines.`);
  rl.close();
}

main().catch((err) => {
  console.error(err.message);
  rl.close();
  process.exit(1);
});
