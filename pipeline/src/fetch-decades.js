// Fetches one representative year per decade so the curation UI has a real
// spread of eras to shuffle across, instead of only whichever years were
// fetched one at a time. One month per year to keep this quick and light on
// the NYT rate limit (5 req/min) — run fetch-nyt.js directly for a specific
// year/month range if you want deeper coverage of one era later.
//
// Usage: node src/fetch-decades.js [--month=6]

import { fetchYear } from './fetch-nyt.js';

const DEFAULT_YEARS = [1955, 1965, 1975, 1985, 1995, 2005, 2015, 2025];
const INTER_YEAR_DELAY_MS = 6000; // same NYT rate limit fetch-nyt.js respects between months

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  let month = 6;
  for (const arg of argv) {
    const match = arg.match(/^--month=(\d{1,2})$/);
    if (match) month = Number(match[1]);
  }
  return { month };
}

async function main() {
  const { month } = parseArgs(process.argv.slice(2));

  console.log(`Fetching month ${month} for years: ${DEFAULT_YEARS.join(', ')}\n`);

  for (let i = 0; i < DEFAULT_YEARS.length; i++) {
    const year = DEFAULT_YEARS[i];
    if (year > new Date().getUTCFullYear()) {
      console.log(`Skipping ${year} (in the future).`);
      continue;
    }
    await fetchYear(year, { startMonth: month, endMonth: month });
    if (i < DEFAULT_YEARS.length - 1) await sleep(INTER_YEAR_DELAY_MS);
  }

  console.log('\nDone fetching decade spread.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
