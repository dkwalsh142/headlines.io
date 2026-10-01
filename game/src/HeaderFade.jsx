import { AnimatePresence, motion } from 'motion/react';

// Fades a piece of the header row (above the paper) out and its replacement
// in whenever `swapKey` changes, on the same 0.4s-out-then-0.4s-in rhythm as
// the paper's slide (paperSlide.js), so text and paper change together.
// `propagate` lets it fade out too when the whole page view is leaving
// (App's home <-> round swap).
const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.4, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.4, ease: 'easeIn' } },
};

export default function HeaderFade({ swapKey, children }) {
  return (
    <AnimatePresence mode="wait" propagate>
      <motion.div key={swapKey} className="header-fade" {...FADE}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
