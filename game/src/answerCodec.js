// Obfuscates each headline's answer (year + archive link) in the shipped
// data, so it can't be read at a glance in the Network tab or React
// DevTools. This is a deterrent, NOT security: the decode key is right here
// in the client bundle, so anyone who reads the code can recover answers.
// Real protection needs server-side scoring (design doc Phase 4).
//
// Shared by scripts/export-data.js (encode, in Node) and the game (decode,
// in the browser) — both environments have TextEncoder/TextDecoder and
// btoa/atob.
//
// Scheme: JSON -> UTF-8 bytes -> XOR with a keystream seeded from the
// headline's opaque id -> base64. Seeding per id means identical answers
// (e.g. two headlines from the same year) don't encode to identical strings.

const KEY_SALT = 'headlines.io/answer/v1';

function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function keystream(id, length) {
  let a = hashSeed(KEY_SALT + id);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    bytes[i] = (t ^ (t >>> 14)) & 0xff;
  }
  return bytes;
}

function xor(bytes, id) {
  const key = keystream(id, bytes.length);
  return bytes.map((b, i) => b ^ key[i]);
}

// answer: { year, sourceUrl? } -> opaque string
export function encodeAnswer(id, answer) {
  const bytes = xor(new TextEncoder().encode(JSON.stringify(answer)), id);
  return btoa(String.fromCharCode(...bytes));
}

// opaque string -> { year, sourceUrl? }
export function decodeAnswer(id, encoded) {
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(xor(bytes, id)));
}
