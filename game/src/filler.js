// Deterministic gibberish-text generator for newspaper "filler" columns —
// decorative fake stories that fill leftover page space around the real
// headline. Same seed always produces the same output (FNV-1a hash -> a
// mulberry32 PRNG, no Math.random anywhere), so a headline's filler is
// stable across re-renders/remounts instead of reshuffling. Words that
// happen to contain an offensive root (blocklist.js) are regenerated.

import { isBlocked } from './blocklist.js';

function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}

function pick(rand, arr) {
  return arr[randInt(rand, 0, arr.length - 1)];
}

const SIMPLE_CONSONANTS = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'z'];
const BLEND_CONSONANTS = ['th', 'sh', 'ch', 'cr', 'br', 'st', 'tr', 'gl', 'pl'];
const SIMPLE_VOWELS = ['a', 'e', 'i', 'o', 'u'];
const VOWEL_DIGRAPHS = ['ae', 'ou', 'ea', 'io'];
const SYLLABLE_COUNT_WEIGHTS = [1, 2, 2, 3, 3, 3, 4];

function pickConsonant(rand) {
  return rand() < 0.78 ? pick(rand, SIMPLE_CONSONANTS) : pick(rand, BLEND_CONSONANTS);
}

function pickVowel(rand) {
  return rand() < 0.85 ? pick(rand, SIMPLE_VOWELS) : pick(rand, VOWEL_DIGRAPHS);
}

function makeSyllable(rand, isLast) {
  let syl = pickConsonant(rand) + pickVowel(rand);
  if (isLast && rand() < 0.3) syl += pickConsonant(rand).slice(0, 1);
  return syl;
}

function buildWord(rand) {
  const syllables = pick(rand, SYLLABLE_COUNT_WEIGHTS);
  let word = '';
  for (let i = 0; i < syllables; i++) {
    word += makeSyllable(rand, i === syllables - 1);
  }
  return word;
}

const MAX_WORD_ATTEMPTS = 50;
const FALLBACK_WORD = 'lomo';

// Retries with the same seeded stream, so output stays deterministic per
// seed. The attempt cap only guards against an infinite loop; with the
// current tables and blocklist a clean word turns up within a few tries.
function makeWord(rand) {
  for (let attempt = 0; attempt < MAX_WORD_ATTEMPTS; attempt++) {
    const word = buildWord(rand);
    if (!isBlocked(word)) return word;
  }
  return FALLBACK_WORD;
}

function makeSentence(rand) {
  const wordCount = randInt(rand, 6, 14);
  const words = [];
  for (let i = 0; i < wordCount; i++) words.push(makeWord(rand));
  let sentence = words.join(' ');
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  const terminator = rand() < 0.88 ? '.' : rand() < 0.5 ? '?' : '!';
  return sentence + terminator;
}

function makeParagraph(rand, minSentences = 3, maxSentences = 6) {
  const sentenceCount = randInt(rand, minSentences, maxSentences);
  const sentences = [];
  for (let i = 0; i < sentenceCount; i++) sentences.push(makeSentence(rand));
  return sentences.join(' ');
}

function makeHeadline(rand) {
  const wordCount = randInt(rand, 2, 5);
  const words = [];
  for (let i = 0; i < wordCount; i++) words.push(makeWord(rand).toUpperCase());
  return words.join(' ');
}

export function makeFillerStories(
  seed,
  count,
  { minParagraphs = 1, maxParagraphs = 3, minSentences = 3, maxSentences = 6 } = {}
) {
  const rand = mulberry32(hashSeed(String(seed)));
  const stories = [];
  for (let i = 0; i < count; i++) {
    const paragraphCount = randInt(rand, minParagraphs, maxParagraphs);
    const paragraphs = [];
    for (let p = 0; p < paragraphCount; p++) paragraphs.push(makeParagraph(rand, minSentences, maxSentences));
    stories.push({ headline: makeHeadline(rand), paragraphs });
  }
  return stories;
}

export function makeContinuedPage(seed) {
  const rand = mulberry32(hashSeed(String(seed)));
  const letter = pick(rand, ['A', 'B', 'C', 'D']);
  const page = randInt(rand, 1, 20);
  return `Cont'd on ${letter}${page}`;
}
