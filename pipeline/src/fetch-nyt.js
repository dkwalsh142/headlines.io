// Pulls headlines from the NYT Archive API (https://developer.nytimes.com/docs/archive-product/1/overview)
// by month, and writes one raw dump per year to data/raw/nyt_<year>.json so a
// year already fetched is never re-fetched. See design doc §4.1.
//
// Usage: node src/fetch-nyt.js <year> [--start-month=1] [--end-month=12]

import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const NYT_ARCHIVE_URL = 'https://api.nytimes.com/svc/archive/v1';
const RAW_DIR = new URL('../data/raw/', import.meta.url);
const REQUEST_DELAY_MS = 6000; // NYT rate limit: 5 req / minute on the default plan

function parseArgs(argv) {
  const [yearArg, ...rest] = argv;
  const year = Number(yearArg);
  if (!year || year < 1851 || year > new Date().getUTCFullYear()) {
    throw new Error(`Usage: node src/fetch-nyt.js <year> [--start-month=1] [--end-month=12]`);
  }

  let startMonth = 1;
  let endMonth = 12;
  for (const arg of rest) {
    const startMatch = arg.match(/^--start-month=(\d{1,2})$/);
    const endMatch = arg.match(/^--end-month=(\d{1,2})$/);
    if (startMatch) startMonth = Number(startMatch[1]);
    if (endMatch) endMonth = Number(endMatch[1]);
  }

  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12 || startMonth > endMonth) {
    throw new Error('Invalid --start-month/--end-month range.');
  }

  return { year, startMonth, endMonth };
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

function toRawRecord(doc) {
  return {
    source: 'nyt',
    nytId: doc._id,
    text: doc.headline?.main ?? null,
    pubDate: doc.pub_date ?? null,
    section: doc.section_name ?? null,
    sourceUrl: doc.web_url ?? null,
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

async function main() {
  const apiKey = process.env.NYT_API_KEY;
  if (!apiKey) {
    throw new Error('NYT_API_KEY is not set. Copy .env.example to .env and add your key.');
  }

  const { year, startMonth, endMonth } = parseArgs(process.argv.slice(2));

  await mkdir(RAW_DIR, { recursive: true });
  const outPath = path.join(new URL(RAW_DIR).pathname, `nyt_${year}.json`);
  const existing = await loadExisting(outPath);
  const seenIds = new Set(existing.map((r) => r.nytId));

  const monthlyRecords = [];
  for (let month = startMonth; month <= endMonth; month++) {
    console.log(`Fetching NYT archive ${year}-${String(month).padStart(2, '0')}...`);
    const docs = await fetchMonth(year, month, apiKey);
    const records = docs.map(toRawRecord).filter((r) => r.text && !seenIds.has(r.nytId));
    monthlyRecords.push(...records);
    records.forEach((r) => seenIds.add(r.nytId));

    if (month < endMonth) await sleep(REQUEST_DELAY_MS);
  }

  const combined = [...existing, ...monthlyRecords];
  await writeFile(outPath, JSON.stringify(combined, null, 2));
  console.log(`Wrote ${combined.length} total records (${monthlyRecords.length} new) to ${outPath}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
