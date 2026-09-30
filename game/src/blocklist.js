// Offensive roots the filler generator (filler.js) must never produce. A
// generated word is rejected if it CONTAINS any of these, so short roots also
// catch longer forms. Over-blocking is harmless here: a rejected word is just
// regenerated as different gibberish, so there's no Scunthorpe problem.
//
// Only roots spellable from filler.js's syllable tables matter (no q, x, or
// y; no doubled consonants mid-word), but a few unreachable spellings are
// kept anyway in case those tables change. To look for gaps, run
// `npm run check-filler -- <path to a reference word list>`.

export const BLOCKED_ROOTS = [
  // Profanity and sexual terms
  'fuc', 'fuk', 'shit', 'piss', 'cunt', 'cock', 'dick', 'prick', 'twat',
  'wank', 'bitch', 'bastard', 'slut', 'whore', 'tit', 'boob', 'cum', 'jizz',
  'anal', 'anus', 'penis', 'vagina', 'clit', 'semen', 'dildo', 'porn',
  'rape', 'rapist', 'molest', 'pedo', 'incest',
  // Found by check-filler against the LDNOOBW list
  'boner', 'erotic', 'fecal', 'guro', 'lolita', 'nawashi', 'nude', 'pubes',
  'shibari', 'shota',

  // Slurs
  'nig', 'negro', 'darkie', 'coon', 'fag', 'dyke', 'tranni', 'trann',
  'homo', 'lesbo', 'shemale', 'retard', 'tard', 'spic', 'chink', 'gook',
  'kike', 'wop', 'jap', 'paki', 'beaner', 'wetback', 'raghead', 'towelhead',
  'gipsi', 'gipo', 'kaffir', 'kafir',

  // Hate references
  'nazi', 'hitler', 'heil',
];

export function isBlocked(word) {
  const lower = word.toLowerCase();
  return BLOCKED_ROOTS.some((root) => lower.includes(root));
}
