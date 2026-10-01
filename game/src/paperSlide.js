// How a newspaper page enters and leaves: slides in from the right while
// spinning flat, and slides off to the left spinning the other way. Shared by
// the headline/results pages (RoundPlayer) and the front page <-> stats swap
// (App), spread onto a motion element inside <AnimatePresence mode="wait">.
export const PAPER_SLIDE = {
  initial: { x: '100%', opacity: 0, rotate: 15 },
  animate: { x: 0, opacity: 1, rotate: 0, transition: { duration: 0.4, ease: 'easeOut' } },
  exit: { x: '-100%', opacity: 0, rotate: -15, transition: { duration: 0.4, ease: 'easeIn' } },
};
