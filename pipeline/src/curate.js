// Local interactive CLI: shows one raw headline at a time from data/raw/,
// lets you reject junk/duplicates, rate difficulty, and tag a section, all in
// one pass (design doc §4.2). Approved items are appended to data/approved.json.
//
// Usage: node src/curate.js <year>
// (A browser-based alternative with the same underlying logic is available via
// `npm run curate-ui` — see curate-ui-server.js.)

import readline from 'node:readline';
import { SECTIONS, appendApproved, buildApprovedRecord, loadPendingForYear, markManualRejected } from './curationStore.js';

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

async function main() {
  const year = process.argv[2];
  if (!year) {
    throw new Error('Usage: node src/curate.js <year>');
  }

  const { rawRecords, approved, pending } = await loadPendingForYear(year);

  console.log(`${pending.length} headlines to review for ${year} (${rawRecords.length - pending.length} already curated).\n`);
  console.log('Commands: [a]pprove, [r]eject, [s]kip, [q]uit\n');

  let reviewed = 0;
  for (const record of pending) {
    console.log('---');
    console.log(`"${record.text}"`);
    console.log(`  ${record.pubDate}  ·  ${record.section ?? 'unknown section'}  ·  ${record.sourceUrl}`);

    const action = (await ask('  a/r/s/q > ')).trim().toLowerCase();
    if (action === 'q') break;
    if (action === 'r') {
      await markManualRejected(record.nytId, year);
      reviewed++;
      continue; // persisted as rejected — won't resurface on a later run
    }
    if (action !== 'a') {
      reviewed++;
      continue; // skip: session-local only, will resurface next run
    }

    const difficultyRaw = await ask(`  difficulty 1-5 > `);
    if (difficultyRaw === 'q' && stdinClosed) break;

    const sectionRaw = (await ask(`  section (${SECTIONS.join('/')}) > `)).trim().toLowerCase();
    if (sectionRaw === 'q' && stdinClosed) break;

    let newRecord;
    try {
      newRecord = buildApprovedRecord(record, { difficulty: Number(difficultyRaw), section: sectionRaw });
    } catch (err) {
      console.log(`  ${err.message} — skipping this headline.`);
      continue;
    }

    await appendApproved(approved, newRecord);
    reviewed++;
  }

  console.log(`\nReviewed ${reviewed}/${pending.length}. Approved backlog now has ${approved.length} headlines.`);
  rl.close();
}

main().catch((err) => {
  console.error(err.message);
  rl.close();
  process.exit(1);
});
