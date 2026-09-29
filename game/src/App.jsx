import { useEffect, useState } from 'react';
import { loadGameData } from './loadRounds.js';
import RoundPlayer from './RoundPlayer.jsx';
import './App.css';

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeRound, setActiveRound] = useState(null); // the round object currently being played
  const [completedTotals, setCompletedTotals] = useState({}); // roundId -> total score, this session only

  useEffect(() => {
    loadGameData().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="state-message">Failed to load: {error}</div>;
  if (!data) return <div className="state-message">Loading…</div>;

  if (activeRound) {
    return (
      <RoundPlayer
        round={activeRound}
        onExit={() => setActiveRound(null)}
        onComplete={(total) => {
          setCompletedTotals((prev) => ({ ...prev, [activeRound.id]: total }));
          setActiveRound(null);
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <h1>Headlines</h1>

      <section className="today-section pixel-frame">
        <h2>Today's round</h2>
        {data.todayRound ? (
          <button type="button" className="primary-btn" onClick={() => setActiveRound(data.todayRound)}>
            Play {data.todayRound.date}
          </button>
        ) : (
          <p className="state-message">No round scheduled for today.</p>
        )}
      </section>

      <section className="beta-section pixel-frame">
        <h2>Beta access &mdash; all rounds</h2>
        <p className="beta-note">
          Every scheduled round, playable in any order. This list won't exist in the shipped game
          (which only ever unlocks today's round) &mdash; it's here so pools can be played through
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
