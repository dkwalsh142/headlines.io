// Merges a remote scoring run's results back into local data/raw/ record-by-
// record (matched by nytId), instead of a blind file overwrite — so this is
// safe to run even if the curation UI was open and making local changes
// (manual reject/approve) while the remote job was in flight.
//
// Merge rule per record, matched by nytId:
//   - Record only exists remotely (e.g. a new month's data another sync
//     brought in) -> add it as-is.
//   - Record exists in both -> keep the LOCAL record's curation-owned fields
//     (manualRejected) untouched, but take the remote's scoring fields
//     (interestScore, whyInteresting, autoRejected, suggestedSection) if the
//     local copy doesn't have a score yet, or --force-rescore is passed.
//   - Record only exists locally (e.g. a manual approve moved it, or remote
//     genuinely doesn't have it) -> keep the local copy.
//
// Usage: node src/merge-remote-results.js <remote-raw-dir> [--force-rescore]

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RAW_DIR as LOCAL_RAW_DIR } from './fetch-nyt.js';

const SCORING_FIELDS = ['interestScore', 'whyInteresting', 'autoRejected', 'suggestedSection'];

function parseArgs(argv) {
  const [remoteDir, ...rest] = argv;
  if (!remoteDir) {
    throw new Error('Usage: node src/merge-remote-results.js <remote-raw-dir> [--force-rescore]');
  }
  const forceRescore = rest.includes('--force-rescore');
  return { remoteDir, forceRescore };
}

async function loadJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function mergeRecords(localRecords, remoteRecords, forceRescore) {
  const localById = new Map(localRecords.map((r) => [r.nytId, r]));
  let added = 0;
  let updated = 0;

  for (const remote of remoteRecords) {
    const local = localById.get(remote.nytId);
    if (!local) {
      localById.set(remote.nytId, remote);
      added++;
      continue;
    }
    // Local record wins by default (protects manualRejected and anything
    // else set locally) — only pull in the remote's scoring fields, and only
    // when local doesn't have a score yet (or forceRescore is explicit).
    const shouldTakeScore = forceRescore || local.interestScore == null;
    if (shouldTakeScore && remote.interestScore != null) {
      for (const field of SCORING_FIELDS) local[field] = remote[field];
      updated++;
    }
  }

  return { merged: [...localById.values()], added, updated };
}

async function main() {
  const { remoteDir, forceRescore } = parseArgs(process.argv.slice(2));
  const localDirPath = new URL(LOCAL_RAW_DIR).pathname;

  const remoteFiles = (await readdir(remoteDir)).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
  console.log(`Merging ${remoteFiles.length} remote files into ${localDirPath}...`);

  let totalAdded = 0;
  let totalUpdated = 0;
  for (const file of remoteFiles) {
    const remotePath = path.join(remoteDir, file);
    const localPath = path.join(localDirPath, file);

    const remoteRecords = await loadJsonSafe(remotePath);
    if (!remoteRecords) continue;
    const localRecords = (await loadJsonSafe(localPath)) ?? [];

    const { merged, added, updated } = mergeRecords(localRecords, remoteRecords, forceRescore);
    if (added || updated) {
      await writeFile(localPath, JSON.stringify(merged, null, 2));
      console.log(`  ${file}: +${added} new, ${updated} scored`);
    }
    totalAdded += added;
    totalUpdated += updated;
  }

  console.log(`\nDone. ${totalAdded} new records added, ${totalUpdated} records newly scored.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
