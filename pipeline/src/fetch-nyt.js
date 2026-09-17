// Pulls headlines from the NYT Archive API (https://developer.nytimes.com/docs/archive-product/1/overview)
// by month, and writes one raw dump per year to data/raw/nyt_<year>.json so a
// year already fetched is never re-fetched. See design doc §4.1.
//
// The Archive API returns every article NYT published that month across every
// desk (Food, Real Estate, Well, Books, etc.), not just major news — most of
// that is a poor fit for "guess the year from this headline" (design doc
// wants headlines that are actually evocative/historic, not routine). NYT
// doesn't expose an explicit "front page" flag, but print_section + print_page
// are a reliable proxy: by default this script keeps print_page "1" from
// print sections A, B, C, D — the main front page plus the next three
// lettered sections' own page 1 (each section's own top story for that print
// run). Confirmed via live data that the letter-to-topic mapping is NOT fixed
// across eras or even within one (e.g. 2015's Section C mixed Culture and
// Weekend; 1995's Section B mixed Metro, National, and Sports) — this is
// "whatever ran atop that lettered section that day," not a guaranteed topic
// filter. Pass --sections=A,B to narrow, or --all-sections to skip page/
// section filtering entirely and fetch everything unfiltered.
//
// Usage: node src/fetch-nyt.js <year> [--start-month=1] [--end-month=12]
//          [--sections=A,B,C,D] [--all-sections]

import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const NYT_ARCHIVE_URL = 'https://api.nytimes.com/svc/archive/v1';
export const RAW_DIR = new URL('../data/raw/', import.meta.url);
const REQUEST_DELAY_MS = 6000; // NYT rate limit: 5 req / minute on the default plan
const MIN_YEAR = 1900; // don't sample earlier — NYT's archive predates this (1851) but the game doesn't need it

function parseArgs(argv) {
  const [yearArg, ...rest] = argv;
  const year = Number(yearArg);
  if (!year || year < MIN_YEAR || year > new Date().getUTCFullYear()) {
    throw new Error(`Usage: node src/fetch-nyt.js <year> [--start-month=1] [--end-month=12] [--sections=A,B,C] [--all-sections] (year must be ${MIN_YEAR} or later)`);
  }

  let startMonth = 1;
  let endMonth = 12;
  let allSections = false;
  let sections = ['A', 'B', 'C', 'D'];
  for (const arg of rest) {
    const startMatch = arg.match(/^--start-month=(\d{1,2})$/);
    const endMatch = arg.match(/^--end-month=(\d{1,2})$/);
    const sectionsMatch = arg.match(/^--sections=(.+)$/);
    if (startMatch) startMonth = Number(startMatch[1]);
    if (endMatch) endMonth = Number(endMatch[1]);
    if (sectionsMatch) sections = sectionsMatch[1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (arg === '--all-sections') allSections = true;
  }

  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12 || startMonth > endMonth) {
    throw new Error('Invalid --start-month/--end-month range.');
  }
  if (!sections.length) {
    throw new Error('--sections must list at least one section letter, e.g. --sections=A,B,C');
  }

  return { year, startMonth, endMonth, allSections, sections };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMonth(year, month, apiKey) {
  const url = `${NYT_ARCHIVE_URL}/${year}/${month}.json?api-key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`NYT Archive API request failed for ${year}-${month}: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  return body.response?.docs ?? [];
}

// print_page "1" is the reliable front-page signal across NYT's whole archive.
// print_section is ALSO required to be one of `sections` in modern-era
// records, but older archives (pre-1980s or so) often leave print_section
// entirely unset even for genuine front-page stories — so a record with no
// section at all is only accepted when "A" (the main front page) is one of
// the requested sections, since an unset section can't be confidently
// attributed to any other specific lettered section. Also drop the literal
// page-scan placeholder entries ("Front Page 1 -- No Title") some older
// archive months include.
function isFrontPage(doc, sections) {
  if (String(doc.print_page) !== '1') return false;
  if (doc.print_section) {
    if (!sections.includes(doc.print_section)) return false;
  } else if (!sections.includes('A')) {
    return false;
  }
  if (/^Front Page \d+ -- No Title$/.test(doc.headline?.main ?? '')) return false;
  return true;
}

function toRawRecord(doc) {
  return {
    source: 'nyt',
    nytId: doc._id,
    text: doc.headline?.main ?? null,
    pubDate: doc.pub_date ?? null,
    section: doc.section_name ?? null,
    sourceUrl: doc.web_url ?? null,
    printSection: doc.print_section ?? null,
    printPage: doc.print_page ?? null,
  };
}

async function loadExisting(filePath) {
  try {
    const contents = await readFile(filePath, 'utf-8');
    return JSON.parse(contents);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function metaPath(year) {
  return path.join(new URL(RAW_DIR).pathname, `nyt_${year}.meta.json`);
}

// Tracks which (month, sections) combinations have actually been attempted
// against the API for this year — separate from the records array so nothing
// else that reads nyt_<year>.json (curationStore.js, score-headlines.js, the
// curation UI server) needs to change. This exists because some eras (pre-
// ~1980s) never tag print_section on the wire at all: for those months, no
// amount of re-fetching will ever surface a "B"/"C"/"D" record, so without
// this a broader --sections request would retry the exact same (year, month)
// forever, burning real API quota for zero possible gain every time.
async function loadFetchedMonths(year) {
  try {
    const contents = await readFile(metaPath(year), 'utf-8');
    return JSON.parse(contents);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function saveFetchedMonths(year, fetchedMonths) {
  await writeFile(metaPath(year), JSON.stringify(fetchedMonths, null, 2));
}

// A month is considered already covered for a given sections request if it
// was previously fetched with a sections list that's a superset of what's
// being asked for now (e.g. a prior --sections=A,B,C,D run also covers a
// later --sections=A,B request).
function monthAlreadyChecked(fetchedMonths, month, sections) {
  const attempted = fetchedMonths[String(month).padStart(2, '0')];
  if (!attempted) return false;
  return sections.every((s) => attempted.includes(s));
}

// Exported so other scripts (e.g. fetch-decades.js) can fetch multiple years
// without shelling out to this file once per year.
export async function fetchYear(year, { startMonth = 1, endMonth = 12, allSections = false, sections = ['A', 'B', 'C', 'D'] } = {}) {
  const apiKey = process.env.NYT_API_KEY;
  if (!apiKey) {
    throw new Error('NYT_API_KEY is not set. Copy .env.example to .env and add your key.');
  }

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(new URL(RAW_DIR).pathname, `nyt_${year}.json`);
  const existing = await loadExisting(outPath);
  const seenIds = new Set(existing.map((r) => r.nytId));
  const fetchedMonths = allSections ? {} : await loadFetchedMonths(year);

  const monthlyRecords = [];
  for (let month = startMonth; month <= endMonth; month++) {
    if (!allSections && monthAlreadyChecked(fetchedMonths, month, sections)) {
      console.log(`  ${year}-${String(month).padStart(2, '0')}: already checked for sections ${sections.join(',')} — nothing more available, skipping API call.`);
      continue;
    }

    console.log(`Fetching NYT archive ${year}-${String(month).padStart(2, '0')}...`);
    const docs = await fetchMonth(year, month, apiKey);
    const kept = allSections ? docs : docs.filter((doc) => isFrontPage(doc, sections));
    const records = kept.map(toRawRecord).filter((r) => r.text && !seenIds.has(r.nytId));
    monthlyRecords.push(...records);
    records.forEach((r) => seenIds.add(r.nytId));

    const skipped = docs.length - kept.length;
    if (!allSections && skipped > 0) {
      console.log(`  kept ${kept.length}/${docs.length} (sections ${sections.join(',')} page 1 only, skipped ${skipped})`);
    }

    if (!allSections) {
      const key = String(month).padStart(2, '0');
      const prior = fetchedMonths[key] ?? [];
      fetchedMonths[key] = [...new Set([...prior, ...sections])];
    }

    if (month < endMonth) await sleep(REQUEST_DELAY_MS);
  }

  const combined = [...existing, ...monthlyRecords];
  await writeFile(outPath, JSON.stringify(combined, null, 2));
  if (!allSections) await saveFetchedMonths(year, fetchedMonths);
  console.log(`Wrote ${combined.length} total records (${monthlyRecords.length} new) to ${outPath}`);
  return { outPath, total: combined.length, added: monthlyRecords.length };
}

async function main() {
  const { year, startMonth, endMonth, allSections, sections } = parseArgs(process.argv.slice(2));
  await fetchYear(year, { startMonth, endMonth, allSections, sections });
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
