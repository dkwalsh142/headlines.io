import { formatPlayDate } from './formatDate.js';
import { Masthead } from './Newspaper.jsx';
import { SECTION_LABEL } from './sections.js';
import StampText from './StampText.jsx';
import TornFrame from './TornFrame.jsx';
import './Newspaper.css';

// The issue's closing page, styled as one more newspaper: the lead story is
// the player's total score, and a row of short articles below recaps each
// headline (section, the real headline, guess vs. actual, points, and a link
// to the archive article).

const MAX_POINTS_PER_HEADLINE = 1000; // matches scoring.js MAX_POINTS
const SCORE_STAMP_DELAY = 0.4; // after the paper's slide-in lands, like headlines

export default function ResultsPaper({ seed, title, date, results, onContinue }) {
  const total = results.reduce((sum, r) => sum + r.points, 0);
  const possible = results.length * MAX_POINTS_PER_HEADLINE;

  return (
    <TornFrame seed={seed} className="newspaper results-paper" aria-label={`${title}: final score`}>
      <Masthead title={title} left="Results" center="Final Edition" right={formatPlayDate(date)} />

      <div className="rp-lead">
        <h3 className="rp-score">
          <StampText text={`${total.toLocaleString()} Points`} delay={SCORE_STAMP_DELAY} />
        </h3>
        <p className="rp-deck">out of a possible {possible.toLocaleString()}</p>
        <button type="button" className="primary-btn rp-continue" onClick={() => onContinue(total)}>
          Continue
        </button>
      </div>

      <div className="rp-articles">
        {results.map((r, i) => (
          <article className="rp-article" key={r.headline.id}>
            <p className="rp-kicker">
              No. {i + 1} &middot; {SECTION_LABEL[r.headline.section] ?? r.headline.section}
            </p>
            <h4 className="rp-headline">{r.headline.text}</h4>
            <p className="rp-years">
              Guessed {r.guessYear}
              <br />
              Actual {r.year}
            </p>
            <p className="rp-points">+{r.points.toLocaleString()} pts</p>
            {r.sourceUrl && (
              <a className="rp-link" href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
                Read the archive article &rarr;
              </a>
            )}
          </article>
        ))}
      </div>
    </TornFrame>
  );
}
