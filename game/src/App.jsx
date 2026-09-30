import { useEffect, useState } from 'react';
import FrontPage from './FrontPage.jsx';
import { loadGameData } from './loadRounds.js';
import RoundPlayer from './RoundPlayer.jsx';
import { loadScores, saveScore } from './scoreStore.js';
import Settings from './Settings.jsx';
import './App.css';

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeRound, setActiveRound] = useState(null); // the round object currently being played
  // roundId -> latest total score, persisted across visits (scoreStore.js)
  const [completedTotals, setCompletedTotals] = useState(loadScores);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadGameData().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="state-message">Failed to load: {error}</div>;
  if (!data) return <div className="state-message">Loading…</div>;

  if (showSettings) return <Settings onBack={() => setShowSettings(false)} />;

  if (activeRound) {
    return (
      <RoundPlayer
        round={activeRound}
        onScore={(total) => {
          // Replays overwrite: the newest score for an issue is the one kept.
          saveScore(activeRound.id, total);
          setCompletedTotals((prev) => ({ ...prev, [activeRound.id]: total }));
        }}
        onExit={() => setActiveRound(null)}
        onComplete={() => setActiveRound(null)}
      />
    );
  }

  return (
    <div className="app-shell">
      <FrontPage
        todayRound={data.todayRound}
        todayTotal={data.todayRound ? completedTotals[data.todayRound.id] : undefined}
        onPlay={() => setActiveRound(data.todayRound)}
        onSettings={() => setShowSettings(true)}
      />

      <section className="beta-section pixel-frame">
        <h2>Beta access &mdash; all issues</h2>
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
                {round.id in completedTotals ? 'Replay' : 'Play'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
