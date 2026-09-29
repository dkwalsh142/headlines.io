import { useState } from 'react';
import { scoreGuess } from './scoring.js';

// Game loop (design doc §6.2):
// idle -> showing_headline -> awaiting_guess -> revealing -> next_headline | round_complete
const SECTION_LABEL = {
  politics: 'Politics', world: 'World', business: 'Business', sports: 'Sports',
  arts: 'Arts', science: 'Science', opinion: 'Opinion', style: 'Style',
};

const MIN_YEAR = 1850;

export default function RoundPlayer({ round, onComplete, onExit }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState('showing_headline');
  const [guess, setGuess] = useState('');
  const [results, setResults] = useState([]); // [{headline, guessYear, points}]

  const headline = round.headlines[index];
  const maxYear = new Date().getUTCFullYear();

  function submitGuess() {
    const guessYear = Number(guess);
    if (!Number.isInteger(guessYear) || guessYear < MIN_YEAR || guessYear > maxYear) return;
    const points = scoreGuess(guessYear, headline.year);
    setResults((prev) => [...prev, { headline, guessYear, points }]);
    setPhase('revealing');
  }

  function next() {
    if (index + 1 >= round.headlines.length) {
      setPhase('round_complete');
    } else {
      setIndex((i) => i + 1);
      setGuess('');
      setPhase('showing_headline');
    }
  }

  if (phase === 'round_complete') {
    const total = results.reduce((sum, r) => sum + r.points, 0);
    return (
      <div className="round-complete">
        <h2>Round complete</h2>
        <div className="total-score">{total.toLocaleString()} points</div>
        <ul className="result-breakdown">
          {results.map((r, i) => (
            <li key={i} className="pixel-frame">
              <span className="rb-section">{SECTION_LABEL[r.headline.section] ?? r.headline.section}</span>
              <span className="rb-text">{r.headline.text}</span>
              <span className="rb-years">guessed {r.guessYear} &middot; actual {r.headline.year}</span>
              <span className="rb-points">{r.points} pts</span>
              {r.headline.sourceUrl && (
                <a className="rb-link" href={r.headline.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Read the NYT archive article &rarr;
                </a>
              )}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => onComplete(total)}>Continue</button>
      </div>
    );
  }

  return (
    <div className="round-player">
      <div className="round-player-head">
        <span>Headline {index + 1} of {round.headlines.length}</span>
        <button type="button" className="exit-btn" onClick={onExit} title="Exit round">&times;</button>
      </div>

      <div className="headline-card pixel-frame">
        <span className="headline-section">{SECTION_LABEL[headline.section] ?? headline.section}</span>
        <p className="headline-text">{headline.text}</p>
      </div>

      {phase === 'showing_headline' && (
        <button type="button" className="primary-btn" onClick={() => setPhase('awaiting_guess')}>
          Guess the year
        </button>
      )}

      {phase === 'awaiting_guess' && (
        <form
          className="guess-form"
          onSubmit={(e) => { e.preventDefault(); submitGuess(); }}
        >
          <input
            type="number"
            inputMode="numeric"
            placeholder={`Year (${MIN_YEAR}-${maxYear})`}
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            min={MIN_YEAR}
            max={maxYear}
            autoFocus
          />
          <button type="submit" className="primary-btn">Submit</button>
        </form>
      )}

      {phase === 'revealing' && (
        <div className="reveal pixel-frame">
          <div className="reveal-row">
            <span>Your guess: {results[results.length - 1].guessYear}</span>
            <span>Actual: {headline.year}</span>
          </div>
          <div className="reveal-points">+{results[results.length - 1].points} points</div>
          <button type="button" className="primary-btn" onClick={next}>
            {index + 1 >= round.headlines.length ? 'See results' : 'Next headline'}
          </button>
        </div>
      )}
    </div>
  );
}
