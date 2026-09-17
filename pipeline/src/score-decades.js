// Scores headlines across every fetched year, round-robin — one batch from
// 1955, then one from 1965, then 1969, etc., cycling back around — instead of
// exhausting one year before starting the next. This means newly-scored,
// review-ready headlines land across multiple eras as scoring runs, so a
// reviewer using the curation UI sees fresh variety instead of a long stretch
// of just one year while everything else sits at zero.
//
// Usage: node src/score-decades.js [--model=qwen2.5:14b] [--batch-size=20] [--force]

import { listRawYears } from './curationStore.js';
import { scoreOneBatch } from './score-headlines.js';

function parseArgs(argv) {
  let model = 'qwen2.5:14b';
  let batchSize = 20;
  let force = false;
  for (const arg of argv) {
    const modelMatch = arg.match(/^--model=(.+)$/);
    const batchMatch = arg.match(/^--batch-size=(\d+)$/);
    if (modelMatch) model = modelMatch[1];
    if (batchMatch) batchSize = Number(batchMatch[1]);
    if (arg === '--force') force = true;
  }
  return { model, batchSize, force };
}

async function main() {
  const { model, batchSize, force } = parseArgs(process.argv.slice(2));
  const years = await listRawYears();
  if (!years.length) {
    throw new Error('No raw data found. Run fetch-nyt.js or fetch-decades.js first.');
  }

  console.log(`Round-robin scoring across ${years.length} years: ${years.join(', ')}\n`);

  // --force means "re-score everything, ignoring existing scores" — but only
  // for each year's FIRST batch in this run. scoreOneBatch always re-reads
  // interestScore from disk, so once a record has been (re-)scored once, the
  // normal interestScore==null filter naturally picks up from there; holding
  // force===true for a year's later rounds would re-select its already-scored
  // first batch forever instead of advancing.
  const forcedOnce = new Set();

  let active = [...years];
  let totalScored = 0;
  let totalPassing = 0;
  let round = 0;

  while (active.length) {
    round++;
    const stillActive = [];
    for (const year of active) {
      const useForce = force && !forcedOnce.has(year);
      forcedOnce.add(year);

      let result;
      try {
        result = await scoreOneBatch(year, { model, batchSize, force: useForce });
      } catch (err) {
        console.error(`  ${year}: batch failed — ${err.message}`);
        continue;
      }
      if (result.scoredCount === 0) continue; // this year is fully scored, drop it from rotation

      totalScored += result.scoredCount;
      totalPassing += result.passedThreshold;
      console.log(`  ${year}: scored ${result.scoredCount} (${result.passedThreshold} passing), ${result.remaining} left`);
      if (result.remaining > 0) stillActive.push(year);
    }
    active = stillActive;
  }

  console.log(`\nDone. Scored ${totalScored} headlines total (${totalPassing} passing) across ${round} round(s).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
