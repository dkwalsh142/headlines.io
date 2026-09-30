// Dev check for the filler text's offensive-word screen (src/blocklist.js).
// Generates a large sample of fake stories across many seeds, then:
//   1. confirms no generated word contains a blocklisted root (sanity check
//      that filler.js is actually screening), and
//   2. if given a reference word list (one term per line, e.g. the LDNOOBW
//      "List of Dirty, Naughty, Obscene, and Otherwise Bad Words"), reports
//      any reference term that still shows up inside generated words, i.e.
//      candidates to add to the blocklist.
// Exits non-zero if anything is found.
//
// Usage: npm run check-filler [-- path/to/wordlist.txt] [--seeds N]

import { readFileSync } from 'node:fs';
import { makeFillerStories } from '../src/filler.js';
import { isBlocked } from '../src/blocklist.js';

const args = process.argv.slice(2);
const seedsFlag = args.indexOf('--seeds');
const SEED_COUNT = seedsFlag >= 0 ? Number(args[seedsFlag + 1]) : 20000;
const listPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--seeds');

// Mirror how the game asks for filler: long stories, short top stories.
const words = new Map(); // word -> count
for (let i = 0; i < SEED_COUNT; i++) {
  const stories = [
    ...makeFillerStories(`check-${i}`, 2, { minParagraphs: 6, maxParagraphs: 8 }),
    ...makeFillerStories(`check-${i}:short`, 1, { minParagraphs: 1, maxParagraphs: 1, minSentences: 2, maxSentences: 2 }),
  ];
  for (const story of stories) {
    for (const text of [story.headline, ...story.paragraphs]) {
      for (const raw of text.split(' ')) {
        const word = raw.toLowerCase().replace(/[^a-z]/g, '');
        if (word) words.set(word, (words.get(word) ?? 0) + 1);
      }
    }
  }
}
const total = [...words.values()].reduce((a, b) => a + b, 0);
console.log(`Generated ${total.toLocaleString()} words (${words.size.toLocaleString()} distinct) from ${SEED_COUNT.toLocaleString()} seeds.`);

let problems = 0;

const blockedLeaks = [...words.keys()].filter(isBlocked);
if (blockedLeaks.length) {
  problems += blockedLeaks.length;
  console.log(`\nBlocklisted roots got through (filler.js isn't screening?):`, blockedLeaks.slice(0, 20));
} else {
  console.log('Blocklist screen: no blocklisted roots in output.');
}

if (listPath) {
  const reference = [
    ...new Set(
      readFileSync(listPath, 'utf-8')
        .split('\n')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => /^[a-z]{3,}$/.test(t)) // single words only; phrases can't occur
    ),
  ];
  const hits = new Map(); // term -> example words
  for (const word of words.keys()) {
    for (const term of reference) {
      if (word.includes(term)) {
        const examples = hits.get(term) ?? [];
        if (examples.length < 5) examples.push(word);
        hits.set(term, examples);
      }
    }
  }
  if (hits.size) {
    problems += hits.size;
    console.log(`\n${hits.size} reference term(s) found inside generated words — review, and add real ones to src/blocklist.js:`);
    for (const [term, examples] of [...hits].sort()) console.log(`  ${term}: ${examples.join(', ')}`);
  } else {
    console.log(`Reference list (${reference.length} single-word terms): no matches.`);
  }
}

process.exit(problems ? 1 : 0);
