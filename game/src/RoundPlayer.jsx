import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { decodeAnswer } from './answerCodec.js';
import Newspaper from './Newspaper.jsx';
import { clearProgress, loadProgress, saveProgress } from './progressStore.js';
import ResultsPaper from './ResultsPaper.jsx';
import StampText, { STAMP_DURATION, stampDuration, useStampEnabled } from './StampText.jsx';
import { scoreGuess } from './scoring.js';

// Game loop (design doc §6.2):
// idle -> showing_headline -> awaiting_guess -> revealing -> next_headline | issue_complete
//
// Terminology: "issue" = the daily set of 5 headlines (what used to be
// called a "round" in code/copy); each individual headline is now its own
// newspaper page. This only renames user-facing copy and local variables —
// the underlying `round` prop, onComplete callback, and rounds.json/
// dateStringToRoundId in the data layer are untouched (follow-up elsewhere).

const MIN_YEAR = 1850;
const HEADLINE_STAMP_STAGGER = 0.03; // seconds between headline letters
const BUTTON_STAMP_SCALE = 1.5; // Next button's starting size when it stamps on

// Rebuilds this issue's saved progress (progressStore.js) into initial state,
// or starts fresh. Saved results reference headlines by id; if any no longer
// matches the issue (data changed under it), the save is discarded.
function restoreProgress(issue) {
  const saved = loadProgress(issue.id);
  if (!saved || !Array.isArray(saved.results)) return null;
  const results = saved.results.map((r) => ({ ...r, headline: issue.headlines.find((h) => h.id === r.headlineId) }));
  const index = saved.index;
  if (results.some((r) => !r.headline) || !(index >= 0 && index < issue.headlines.length)) return null;
  const guessedCurrent = results.length > index;
  return {
    index,
    results,
    phase: guessedCurrent ? 'revealing' : 'showing_headline',
    guess: guessedCurrent ? String(results[index].guessYear) : '',
  };
}

// onScore(total) fires as soon as the issue is finished (so the score is kept
// even if the player exits from the results page); onComplete is the results
// page's Continue button.
export default function RoundPlayer({ round: issue, onScore, onComplete, onExit }) {
  const [restored] = useState(() => restoreProgress(issue));
  const [index, setIndex] = useState(restored?.index ?? 0);
  const [phase, setPhase] = useState(restored?.phase ?? 'showing_headline');
  const [guess, setGuess] = useState(restored?.guess ?? '');
  const [results, setResults] = useState(restored?.results ?? []); // [{headline, guessYear, year, sourceUrl, points}]
  const stampEnabled = useStampEnabled();

  const headline = issue.headlines[index];
  const maxYear = new Date().getUTCFullYear();

  // Save progress after every guess / advance, so exiting (X, reload, closing
  // the tab) resumes here; a finished issue's progress is dropped.
  useEffect(() => {
    if (phase === 'issue_complete') {
      clearProgress(issue.id);
    } else if (results.length > 0) {
      saveProgress(issue.id, {
        index,
        results: results.map(({ headline: h, ...rest }) => ({ ...rest, headlineId: h.id })),
      });
    }
  }, [issue.id, index, results, phase]);

  function submitGuess() {
    const guessYear = Number(guess);
    if (!Number.isInteger(guessYear) || guessYear < MIN_YEAR || guessYear > maxYear) return;
    // The answer is only decoded here, once a guess is locked in.
    const { year, sourceUrl } = decodeAnswer(headline.id, headline.answer);
    const points = scoreGuess(guessYear, year);
    setResults((prev) => [...prev, { headline, guessYear, year, sourceUrl, points }]);
    setPhase('revealing');
  }

  function next() {
    if (index + 1 >= issue.headlines.length) {
      setPhase('issue_complete');
      onScore?.(results.reduce((sum, r) => sum + r.points, 0));
    } else {
      setIndex((i) => i + 1);
      setGuess('');
      setPhase('showing_headline');
    }
  }

  const isLastHeadline = index + 1 >= issue.headlines.length;
  const lastResult = results[results.length - 1];

  // Shown as soon as the headline is; focusing the field moves the game into
  // awaiting_guess. Stays up (field locked, arrow disabled) while revealing, so
  // the guess reads above the actual year.
  const isRevealing = phase === 'revealing';
  const isComplete = phase === 'issue_complete';
  const guessSlot = (
    <form
      className="guess-form"
      onSubmit={(e) => {
        e.preventDefault();
        // Enter in the locked field would otherwise implicitly re-submit.
        if (!isRevealing) submitGuess();
      }}
    >
      <label className="guess-label" htmlFor="guess-year">Guess the year:</label>
      <input
        id="guess-year"
        type="number"
        inputMode="numeric"
        placeholder={`(${MIN_YEAR}-${maxYear})`}
        value={guess}
        onChange={(e) => setGuess(e.target.value)}
        onFocus={() => phase === 'showing_headline' && setPhase('awaiting_guess')}
        min={MIN_YEAR}
        max={maxYear}
        readOnly={isRevealing}
      />
      {/* Stays visible once a guess is in, just disabled. */}
      <button
        type="submit"
        className="guess-enter"
        aria-label="Submit guess"
        title="Submit (Enter)"
        disabled={isRevealing}
      >
        {/* Pixel-art right arrow (→), drawn on a 9×7 grid to match the pixel font */}
        <svg viewBox="0 0 9 7" width="36" height="28" shapeRendering="crispEdges" aria-hidden="true">
          <path fill="currentColor" d="M0 3h6v1H0zM6 1h1v5H6zM7 2h1v3H7zM8 3h1v1H8z" />
        </svg>
      </button>
    </form>
  );

  const actualText = isRevealing ? `Actual: ${lastResult.year}` : '';
  const pointsText = isRevealing ? `+${lastResult.points} points` : '';
  const nextText = isLastHeadline ? 'See results' : 'Next headline';
  // Each results line stamps on after the previous one has settled.
  const pointsDelay = stampDuration(actualText);
  const nextDelay = pointsDelay + stampDuration(pointsText);
  // Rendered from the start as an invisible stand-in with placeholder values
  // (same lines, same sizes), so the paper is already tall enough for the
  // results and doesn't grow when they appear. The real results mount fresh
  // on reveal, which is what kicks off their stamp animation.
  const revealSlot = isRevealing ? (
    <div className="reveal">
      <div className="reveal-row">
        <span><StampText text={actualText} /></span>
      </div>
      <div className="reveal-points">
        <StampText text={pointsText} delay={pointsDelay} />
      </div>
      {/* The whole button stamps down (oversized -> final size) once the
          points line has settled. Starts smaller than the letters' scale,
          since a full-width button at that size would spill across the page. */}
      <motion.button
        type="button"
        className="primary-btn"
        onClick={next}
        initial={stampEnabled ? { scale: BUTTON_STAMP_SCALE, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: nextDelay, duration: STAMP_DURATION, ease: 'easeOut' }}
      >
        {nextText}
      </motion.button>
    </div>
  ) : (
    <div className="reveal" style={{ visibility: 'hidden' }} aria-hidden="true">
      <div className="reveal-row">
        <span>Actual: 0000</span>
      </div>
      <div className="reveal-points">+1000 points</div>
      <button type="button" className="primary-btn" tabIndex={-1}>
        Next headline
      </button>
    </div>
  );

  return (
    <div className="newspaper-stage">
      <div className="newspaper-stage-inner">
        <div className="round-player-head">
          <span>{isComplete ? 'Issue complete' : `Headline ${index + 1} of ${issue.headlines.length}`}</span>
          <button type="button" className="exit-btn" onClick={onExit} title="Exit issue">&times;</button>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={isComplete ? 'results' : headline.id}
            initial={{ x: '100%', opacity: 0, rotate: 15 }}
            animate={{ x: 0, opacity: 1, rotate: 0, transition: { duration: 0.4, ease: 'easeOut' } }}
            exit={{ x: '-100%', opacity: 0, rotate: -15, transition: { duration: 0.4, ease: 'easeIn' } }}
          >
            {isComplete ? (
              // The last headline's paper spins out and this one spins in,
              // same as between headlines.
              <ResultsPaper
                seed={`results-${issue.id}`}
                title="The Daily Headlines"
                date={issue.date}
                results={results}
                onContinue={onComplete}
              />
            ) : (
              <Newspaper
                seed={headline.id}
                section={headline.section}
                issueNumber={index + 1}
                date={issue.date}
                // Month and day only: the current year next to the headline
                // would be a nudge toward guessing it.
                showYear={false}
                title="The Daily Headlines"
                lead={
                  <p className="headline-text">
                    {/* Starts once the paper's 0.4s slide-in has landed; a
                        faster stagger than the default since headlines are long. */}
                    <StampText text={headline.text} delay={0.4} stagger={HEADLINE_STAMP_STAGGER} />
                  </p>
                }
                guess={guessSlot}
              >
                {revealSlot}
              </Newspaper>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
