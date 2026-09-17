// Scores raw headlines for "is this good game material" using a local LLM
// (via Ollama) so the curation UI can surface the most promising candidates
// first instead of reviewing thousands of headlines in raw/random order.
//
// Native 1-5 rubric (tiers 1-2 are auto-rejected, 3-5 reach the reviewer):
//   5 — Iconic/instantly recognizable (moon landing, assassinations, major wars)
//   4 — Widely known, dateable within roughly a decade
//   3 — Plausible, guessable within a wide (15-20yr) window from context clues
//   2 — Auto-reject: needs niche/insider knowledge, or generic enough to be any decade
//   1 — Auto-reject: broken/unusable (year giveaway, stub/wire-blurb, garbled)
//
// This is advisory, not a replacement for manual review (design doc §4.1/§4.2):
// every headline that scores at or above AUTO_REJECT_BELOW still goes through
// the same manual approve/reject/tag pass as before. autoRejected headlines
// are flagged, never deleted, so the threshold can be revisited later without
// re-scoring.
//
// Adds `interestScore` (1-5), `whyInteresting`, `autoRejected`, and
// `suggestedSection` fields in place on data/raw/nyt_<year>.json records.
// suggestedSection is only ever a starting point — curate.js/curate-ui still
// require you to confirm or override it before a headline is approved.
//
// Requires Ollama running locally (`brew services start ollama`) with a
// pulled model (`ollama pull qwen2.5:14b`). llama3.1:8b runs faster but scored
// noticeably worse in testing — it couldn't reliably tell evocative headlines
// from bland ones, so qwen2.5:14b is the default despite being slower.
//
// Usage: node src/score-headlines.js <year> [--model=qwen2.5:14b]
//          [--batch-size=20] [--force] [--target=20]
//
// --target: keep scoring batches (in original order) until this many
//   headlines have scored >= AUTO_REJECT_BELOW, or the dump is exhausted.
//   Omit to score the entire dump in one run.

import { readFile, writeFile } from 'node:fs/promises';
import { SECTIONS, withRawFileLock } from './curationStore.js';

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const RAW_DIR = new URL('../data/raw/', import.meta.url);
const AUTO_REJECT_BELOW = 3; // scores 1-2 are auto-flagged; 3+ still reaches the reviewer

function parseArgs(argv) {
  const [yearArg, ...rest] = argv;
  const year = Number(yearArg);
  if (!year) {
    throw new Error('Usage: node src/score-headlines.js <year> [--model=qwen2.5:14b] [--batch-size=20] [--force] [--target=20]');
  }

  let model = 'qwen2.5:14b';
  let batchSize = 20;
  let force = false;
  let target = null;
  for (const arg of rest) {
    const modelMatch = arg.match(/^--model=(.+)$/);
    const batchMatch = arg.match(/^--batch-size=(\d+)$/);
    const targetMatch = arg.match(/^--target=(\d+)$/);
    if (modelMatch) model = modelMatch[1];
    if (batchMatch) batchSize = Number(batchMatch[1]);
    if (targetMatch) target = Number(targetMatch[1]);
    if (arg === '--force') force = true;
  }

  return { year, model, batchSize, force, target };
}

function buildPrompt(batch) {
  const items = batch.map((r, i) => `${i}. ${r.text}`).join('\n');
  return `You are helping curate headlines for a history trivia game where players \
guess the publication year of a real news headline, seeing ONLY the headline \
text (no byline, no photo, no article).

Score each headline from 1 to 5 using exactly this rubric:

5 — Iconic / instantly recognizable
The event is part of general cultural knowledge; most people could place it \
within a few years without any hint. Major wars, assassinations, moon landing, \
market crashes, presidential elections, terrorist attacks, epoch-defining \
tech/science breakthroughs.
Example: "MEN WALK ON MOON"

4 — Widely known, dateable with reasonable confidence
A well-known event or trend that an informed adult would recognize and could \
place within roughly a decade. Major but not history-book-tier: significant \
legislation, notable deaths of famous (not just important) people, well-known \
sports milestones, major corporate events.
Example: a headline about the fall of a well-known company, a famous athlete's \
record-breaking game.

3 — Plausible, guessable within a wide range
Not iconic, but has enough contextual clues (technology mentioned, social \
attitudes, political tone, language style) that a careful player could narrow \
it to a 15-20 year window even without recognizing the specific event. This is \
the "fair but hard" tier — fine in moderation, shouldn't dominate the pool.

2 — Auto-reject: guessable only by insiders or luck
Requires niche/local knowledge, or is so generic it could plausibly be from \
any decade (routine city council votes, minor crime blotter, unremarkable \
local sports). No real contextual anchor for dating.

1 — Auto-reject: broken or unusable candidate
Contains an explicit year/date giveaway, is a stub/wire-blurb/correction, or \
is too fragmentary/garbled to parse.

Give a one-sentence reason for the score, naming the specific event/figure for \
a 4-5, the contextual clue(s) for a 3, and briefly why it fails for a 1-2.

Also classify each headline into exactly one newspaper desk, even for a low- \
scoring headline: ${SECTIONS.join(', ')}. Pick whichever fits best — this is \
just a starting suggestion a human editor will confirm or correct, not a \
final decision, so always give your best guess rather than omitting it.

Headlines:
${items}

Respond with ONLY valid JSON in this exact shape (an object with a "scores" \
array, one entry per headline, same order, using the headline's number above \
as "index", "score" from 1-5, and "section" as one of the exact section names \
listed above):
{"scores": [{"index": 0, "score": 5, "reason": "...", "section": "world"}, {"index": 1, "score": 2, "reason": "...", "section": "business"}]}`;
}

async function requestScores(batch, model) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: buildPrompt(batch), stream: false, format: 'json' }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Ollama request failed: ${res.status} ${res.statusText}. Is Ollama running (\`brew services start ollama\`) ` +
      `and is the model pulled (\`ollama pull ${model}\`)? ${body}`
    );
  }

  const { response } = await res.json();
  const parsed = JSON.parse(response);
  const results = Array.isArray(parsed) ? parsed : parsed.scores;
  if (!Array.isArray(results)) {
    throw new Error(`Unexpected model response shape: ${response.slice(0, 200)}`);
  }
  return results;
}

function applyResults(batch, results) {
  const unscored = new Set(batch.map((_, i) => i));
  let passedThreshold = 0;
  for (const result of results) {
    const record = batch[result.index];
    if (!record) continue;
    const score = Number(result.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) continue; // leave unscored rather than store a bad value

    record.interestScore = score;
    record.whyInteresting = result.reason ?? null;
    record.autoRejected = score < AUTO_REJECT_BELOW;
    record.suggestedSection = SECTIONS.includes(result.section) ? result.section : null;
    if (!record.autoRejected) passedThreshold++;
    unscored.delete(result.index);
  }
  return { passedThreshold, unscored: [...unscored].map((i) => batch[i]) };
}

// The model occasionally drops an item from a batch response. One retry on
// just the missing subset covers most of those; anything still missing after
// that is left unscored (not stored at all) so a later re-run picks it back
// up naturally via the `interestScore == null` filter in main().
async function scoreBatch(batch, model) {
  let results = await requestScores(batch, model);
  let { passedThreshold, unscored } = applyResults(batch, results);

  if (unscored.length) {
    console.log(`  ${unscored.length} headline(s) missing from response — retrying once...`);
    const retryResults = await requestScores(unscored, model);
    const retryOutcome = applyResults(unscored, retryResults);
    passedThreshold += retryOutcome.passedThreshold;
    if (retryOutcome.unscored.length) {
      console.log(`  ${retryOutcome.unscored.length} headline(s) still unscored after retry — will pick up on next run.`);
    }
  }

  return passedThreshold;
}

// Scores one batch's worth (or fewer, if the year runs out) starting from
// wherever that year last left off, and persists immediately. Exported so
// score-decades.js can round-robin a single batch per year across many years
// per pass, instead of exhausting one year before moving to the next — so
// newly-scored, review-ready headlines land across multiple eras together.
//
// The LLM call is slow (several seconds), so it deliberately runs OUTSIDE the
// file lock — holding a lock for that long would block a concurrent manual
// reject/approve in the curation UI for no good reason. Instead, the file is
// re-read under the lock right before writing, and scores are matched back
// onto that fresh copy by nytId — so this only ever merges its own scoring
// results onto whatever the UI most recently wrote (e.g. a manualRejected
// flag), rather than blindly overwriting the whole file with a stale copy.
export async function scoreOneBatch(year, { model = 'qwen2.5:14b', batchSize = 20, force = false } = {}) {
  const rawPath = new URL(`nyt_${year}.json`, RAW_DIR);
  const records = JSON.parse(await readFile(rawPath, 'utf-8'));

  const toScore = force ? records : records.filter((r) => r.interestScore == null);
  if (!toScore.length) return { scoredCount: 0, passedThreshold: 0, remaining: 0 };

  const batch = toScore.slice(0, batchSize);
  const passedThreshold = await scoreBatch(batch, model);

  await withRawFileLock(year, async () => {
    const latest = JSON.parse(await readFile(rawPath, 'utf-8'));
    const byNytId = new Map(latest.map((r) => [r.nytId, r]));
    for (const scored of batch) {
      const current = byNytId.get(scored.nytId);
      if (!current) continue; // record vanished from disk somehow — skip rather than reintroduce it
      current.interestScore = scored.interestScore;
      current.whyInteresting = scored.whyInteresting;
      current.autoRejected = scored.autoRejected;
      current.suggestedSection = scored.suggestedSection;
    }
    await writeFile(rawPath, JSON.stringify(latest, null, 2));
  });

  return { scoredCount: batch.length, passedThreshold, remaining: toScore.length - batch.length };
}

async function main() {
  const { year, model, batchSize, force, target } = parseArgs(process.argv.slice(2));

  const rawPath = new URL(`nyt_${year}.json`, RAW_DIR);
  const initial = JSON.parse(await readFile(rawPath, 'utf-8'));
  const initialToScore = force ? initial : initial.filter((r) => r.interestScore == null);
  const alreadyPassing = force ? 0 : initial.filter((r) => r.interestScore != null && !r.autoRejected).length;
  const totalToScore = initialToScore.length;

  if (target) {
    console.log(`Scoring ${year} in batches of ${batchSize} until ${target} headlines clear the interest bar (already have ${alreadyPassing})...`);
  } else {
    console.log(`Scoring ${totalToScore}/${initial.length} headlines for ${year} using ${model}...`);
  }

  let scored = 0;
  let passing = alreadyPassing;
  // Only the first call needs `force` (re-score from scratch); after that,
  // scoreOneBatch's own interestScore==null filter naturally picks up where
  // this run left off — see score-decades.js for the same pattern.
  let useForce = force;
  while (scored < totalToScore) {
    if (target && passing >= target) {
      console.log(`Reached target of ${target} passing headlines — stopping early.`);
      break;
    }

    let result;
    try {
      result = await scoreOneBatch(year, { model, batchSize, force: useForce });
    } catch (err) {
      console.error(`  Batch failed: ${err.message}`);
      break;
    }
    useForce = false;
    if (result.scoredCount === 0) break; // nothing left to score

    scored += result.scoredCount;
    passing += result.passedThreshold;
    console.log(`  scored ${scored}/${totalToScore} · ${passing} passing so far`);
  }

  console.log(`Done. Scored ${scored} headlines this run, ${passing} total passing (score >= ${AUTO_REJECT_BELOW}). Saved to ${rawPath.pathname}.`);
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
