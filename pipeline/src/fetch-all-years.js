// Fetches one month (June by default) for every year from MIN_YEAR through the
// current year, so the curation pool draws from the widest possible spread of
// eras rather than a handful of sampled decades.
//
// A year's raw file can hold multiple months and multiple print sections
// merged together (fetchYear dedupes by nytId, so re-running for a different
// month or section set is always safe) — so "already fetched" is checked per
// (year, month, section set), by looking at which (month, printSection) pairs
// actually appear in that year's records, not just whether the file exists.
// Otherwise, once any month/section was fetched for a year, this would
// wrongly skip that year forever on every later month or section request
// (see design doc's "fill out all of 1900-now, one month at a time" plan).
//
// Usage: node src/fetch-all-years.js [--month=6] [--start-year=1900] [--sections=A,B,C]

import { readFile } from 'node:fs/promises';
import { fetchYear, RAW_DIR } from './fetch-nyt.js';
import { listRawYears } from './curationStore.js';

function metaPath(year) {
  return new URL(`nyt_${year}.meta.json`, RAW_DIR);
}

const MIN_YEAR = 1900;
const INTER_YEAR_DELAY_MS = 6000; // same NYT rate limit fetch-nyt.js respects between months

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  let month = 6;
  let startYear = MIN_YEAR;
  let sections = ['A', 'B', 'C', 'D'];
  for (const arg of argv) {
    const monthMatch = arg.match(/^--month=(\d{1,2})$/);
    const startMatch = arg.match(/^--start-year=(\d{4})$/);
    const sectionsMatch = arg.match(/^--sections=(.+)$/);
    if (monthMatch) month = Number(monthMatch[1]);
    if (startMatch) startYear = Math.max(MIN_YEAR, Number(startMatch[1]));
    if (sectionsMatch) sections = sectionsMatch[1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  return { month, startYear, sections };
}

// Delegates to fetch-nyt.js's per-(year, month, sections) tracking (stored in
// nyt_<year>.meta.json) rather than inferring completeness from the records
// themselves — some eras never tag print_section on the wire at all, so
// "does this file contain a B/C/D record for this month" can never become
// true no matter how many times it's fetched. The meta file instead records
// "we asked NYT for these sections in this month," which is knowable even
// when the answer turned out to be "nothing more than what A already covers."
async function hasMonthAndSections(year, month, sections) {
  let fetchedMonths;
  try {
    fetchedMonths = JSON.parse(await readFile(metaPath(year), 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }

  const attempted = fetchedMonths[String(month).padStart(2, '0')];
  if (!attempted) return false;
  return sections.every((s) => attempted.includes(s));
}

async function main() {
  const { month, startYear, sections } = parseArgs(process.argv.slice(2));
  const currentYear = new Date().getUTCFullYear();
  const knownYears = await listRawYears(); // years with a file at all, just for the summary line

  const years = [];
  for (let y = startYear; y <= currentYear; y++) years.push(y);

  console.log(`Fetching month ${month}, sections ${sections.join(',')}, for ${years.length} years (${startYear}-${currentYear})...`);
  console.log(`(${knownYears.length} years already have some data on disk; skipping only where month ${month} + these sections are already present.)\n`);

  let fetched = 0;
  let skipped = 0;
  let hitQuotaWall = false;
  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    if (await hasMonthAndSections(year, month, sections)) {
      skipped++;
      continue;
    }

    try {
      await fetchYear(year, { startMonth: month, endMonth: month, sections });
      fetched++;
    } catch (err) {
      console.error(`  ${year}: failed — ${err.message}`);
      // NYT's daily quota can be hit mid-run; stop rather than spin through
      // the remaining years hitting the same 429 for no benefit. This is an
      // expected, recoverable condition — re-running later picks up cleanly.
      if (err.message.includes('429')) {
        console.error('\nHit NYT rate/quota limit — stopping here. Re-run this script later to pick up where it left off.');
        hitQuotaWall = true;
        break;
      }
      // Any other error is unexpected. Interactive/manual use skips past it
      // (a single flaky year isn't worth aborting a supervised session for),
      // but STRICT_FETCH_ERRORS=1 (set by overnight-run.sh) makes it fatal —
      // an unattended run shouldn't silently produce an incomplete month.
      if (process.env.STRICT_FETCH_ERRORS === '1') {
        console.error(`\nSTRICT_FETCH_ERRORS is set — treating this as fatal.`);
        throw err;
      }
    }

    if (i < years.length - 1) await sleep(INTER_YEAR_DELAY_MS);
  }

  console.log(`\nDone this run. Fetched month ${month} for ${fetched} new years, skipped ${skipped} that already had it.`);
  // Machine-readable marker for overnight-run.sh: only printed when every
  // year in range was already covered or freshly fetched with no 429 —
  // i.e. this month is genuinely complete, not just "this pass didn't crash."
  if (!hitQuotaWall) {
    console.log('MONTH_FULLY_FETCHED');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
