import { motion, useReducedMotion } from 'motion/react';
import { useSettings } from './SettingsContext.jsx';

// Animates text on letter by letter, each letter "stamping" down from
// oversized to its final size. Letters are grouped per word (nowrap) so a
// line can only break between words, never mid-word. Renders plain text
// when the player has turned the effect off in Settings, or has reduced
// motion enabled.

export const STAMP_STAGGER = 0.08; // default seconds between letters
export const STAMP_DURATION = 0.05; // seconds for one letter to settle
const START_SCALE = 2.6;

// Seconds until the last letter of `text` has settled, for chaining several
// StampTexts one after another.
export function stampDuration(text, stagger = STAMP_STAGGER) {
  return Math.max(0, text.length - 1) * stagger + STAMP_DURATION;
}

// Whether the stamp effect should play: on in Settings and the player
// hasn't asked for reduced motion. Exported so things stamped alongside
// text (e.g. a button's box) can follow the same rule.
export function useStampEnabled() {
  const reduceMotion = useReducedMotion();
  const { settings } = useSettings();
  return !reduceMotion && settings.stampText;
}

export default function StampText({ text, delay = 0, stagger = STAMP_STAGGER }) {
  if (!useStampEnabled()) return text;

  let letterIndex = 0;
  const words = text.split(' ');
  return words.map((word, w) => {
    const letters = [...word].map((char) => {
      const i = letterIndex++;
      return (
        <motion.span
          key={i}
          style={{ display: 'inline-block' }}
          initial={{ scale: START_SCALE, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: delay + i * stagger, duration: STAMP_DURATION, ease: 'easeOut' }}
        >
          {char}
        </motion.span>
      );
    });
    letterIndex++; // the space between words takes a beat too
    return (
      <span key={w}>
        <span style={{ whiteSpace: 'nowrap' }}>{letters}</span>
        {w < words.length - 1 && ' '}
      </span>
    );
  });
}
