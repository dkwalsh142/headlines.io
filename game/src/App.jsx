import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import FrontPage from './FrontPage.jsx';
import HeaderFade from './HeaderFade.jsx';
import { PAPER_SLIDE } from './paperSlide.js';
import PixelArrow from './PixelArrow.jsx';
import { loadGameData } from './loadRounds.js';
import { clearAllProgress, loadProgressIds } from './progressStore.js';
import RoundPlayer from './RoundPlayer.jsx';
import { clearScores, loadScores, saveScore } from './scoreStore.js';
import Settings from './Settings.jsx';
import StatsPage from './StatsPage.jsx';
import './App.css';

// Beta panel in/out, on the same 0.4s rhythm as the papers' slide. `delay`
// holds the fade-in until an outgoing paper has finished sliding off.
const betaFade = (delay) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.6, ease: 'easeOut', delay } },
  exit: { opacity: 0, transition: { duration: 0.6, ease: 'easeIn' } },
});

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeRound, setActiveRound] = useState(null); // the round object currently being played
  // roundId -> latest total score, persisted across visits (scoreStore.js)
  const [completedTotals, setCompletedTotals] = useState(loadScores);
  // Issues exited part-way through (progressStore.js), shown as "Resume".
  const [inProgressIds, setInProgressIds] = useState(loadProgressIds);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  // True until the first home view has mounted: the front page appears without
  // sliding in on page load, but slides in when returning from a round.
  const isFirstHome = useRef(true);
  // Whether stats was showing as of the last render: on the render that
  // closes stats it's still true, so the beta panel knows to wait for the
  // stats paper to slide off before fading back in.
  const wasShowingStats = useRef(showStats);
  useEffect(() => {
    wasShowingStats.current = showStats;
  }, [showStats]);
  useEffect(() => {
    if (data) isFirstHome.current = false; // after the first render that shows home
  }, [data]);

  useEffect(() => {
    loadGameData().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="state-message">Failed to load: {error}</div>;
  if (!data) return <div className="state-message">Loading…</div>;

  // Home (front page / stats), Settings, and a round swap through one
  // AnimatePresence, so pressing Play (or opening Settings) slides the front
  // page's paper off before the next view comes in, and leaving a round
  // slides it off before the front page returns. The Settings panel slides
  // the same way as the papers. The papers' own slides live in nested
  // AnimatePresences (RoundPlayer's, and the front/stats one below), which
  // pick up this exit via `propagate`.
  return (
    <AnimatePresence mode="wait">
      {activeRound ? (
        <RoundPlayer
          key={`round-${activeRound.id}`}
          round={activeRound}
          onScore={(total, results) => {
            // Replays overwrite: the newest score for an issue is the one kept.
            saveScore(activeRound.id, total, {
              date: activeRound.date,
              results: results.map((r) => ({
                headlineId: r.headline.id,
                section: r.headline.section,
                guessYear: r.guessYear,
                year: r.year,
                points: r.points,
              })),
            });
            setCompletedTotals((prev) => ({ ...prev, [activeRound.id]: total }));
          }}
          onExit={() => {
            setInProgressIds(loadProgressIds());
            setActiveRound(null);
          }}
          onComplete={() => {
            setInProgressIds(loadProgressIds());
            setActiveRound(null);
          }}
        />
      ) : showSettings ? (
        <motion.div key="settings" {...PAPER_SLIDE}>
          <Settings onBack={() => setShowSettings(false)} />
        </motion.div>
      ) : (
      <div key="home" className="app-shell">
        {/* Front page and stats share one stage: the header row stays put (empty
            on the front page, "Your stats" + Back on stats) while the papers
            swap with the same slide/spin as the headline pages. */}
        <div className="newspaper-stage">
          <div className="newspaper-stage-inner">
            <div className="round-player-head">
              <HeaderFade swapKey={showStats ? 'stats' : 'front'}>
                {showStats && <span>Your stats</span>}
              </HeaderFade>
              <HeaderFade swapKey={showStats ? 'stats' : 'front'}>
                {showStats && (
                  <button type="button" className="text-btn" onClick={() => setShowStats(false)}>
                    <PixelArrow direction="left" unit={2} className="back-arrow" />
                    Back
                  </button>
                )}
              </HeaderFade>
            </div>
            <AnimatePresence mode="wait" initial={!isFirstHome.current} propagate>
              <motion.div key={showStats ? 'stats' : 'front'} {...PAPER_SLIDE}>
                {showStats ? (
                  <StatsPage totalIssues={data.allRounds.length} />
                ) : (
                  <FrontPage
                    todayRound={data.todayRound}
                    todayTotal={data.todayRound ? completedTotals[data.todayRound.id] : undefined}
                    todayInProgress={data.todayRound ? inProgressIds.has(data.todayRound.id) : false}
                    onPlay={() => setActiveRound(data.todayRound)}
                    onStats={() => setShowStats(true)}
                    onSettings={() => setShowSettings(true)}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Fades out whenever the main screen is left (to stats, settings, or a
            round) and back in on return; not on first load. */}
        <AnimatePresence initial={!isFirstHome.current} propagate>
          {!showStats && (
            <motion.section
              key="beta"
              className="beta-section pixel-frame"
              {...betaFade(wasShowingStats.current ? 0.4 : 0)}
            >
              <div className="beta-head">
                <h2>Beta access &mdash; all issues</h2>
                {/* Dev tool: goes away with the rest of this beta panel. */}
                <button
                  type="button"
                  className="beta-reset"
                  disabled={Object.keys(completedTotals).length === 0 && inProgressIds.size === 0}
                  onClick={() => {
                    if (!window.confirm('Reset all saved scores and in-progress issues?')) return;
                    clearScores();
                    clearAllProgress();
                    setCompletedTotals({});
                    setInProgressIds(new Set());
                  }}
                >
                  Reset all scores
                </button>
              </div>
              <p className="beta-note">
                Every scheduled issue, playable in any order. This list won't exist in the shipped game
                (which only ever unlocks today's issue) &mdash; it's here so pools can be played through
                during development.
              </p>
              <ul className="round-list">
                {data.allRounds.map((round) => (
                  <li key={round.id} className="round-list-item pixel-frame">
                    <span className="rl-date">{round.date}</span>
                    <span className="rl-difficulty">
                      {round.difficulty != null ? `difficulty ${round.difficulty}` : 'difficulty n/a'}
                    </span>
                    {round.id in completedTotals && (
                      <span className="rl-score">{completedTotals[round.id]} pts</span>
                    )}
                    <button type="button" onClick={() => setActiveRound(round)}>
                      {inProgressIds.has(round.id) ? 'Resume' : round.id in completedTotals ? 'Replay' : 'Play'}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
      )}
    </AnimatePresence>
  );
}
