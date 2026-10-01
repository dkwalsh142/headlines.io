import { useMemo } from 'react';
import { todayDateString } from './dateUtils.js';
import { makeContinuedPage, makeFillerStories } from './filler.js';
import Newspaper, { FILLER_PARAGRAPHS, FillerLayer } from './Newspaper.jsx';
import StampText from './StampText.jsx';

// The home screen's "front page": the same newspaper as a round page, with
// the lead story inviting the player into today's issue (or reporting their
// score, if they've already played it this session). Fake story columns
// either side, lead always centered. Under the play button, two small
// "stories" side by side — Settings and Support the Developer — each a real
// headline over fake body text that fills whatever space is left.

const HEADLINE_STAMP_STAGGER = 0.03; // matches the round pages' headlines

// Buy-me-a-coffee (or similar) page. Until it's set, the Support headline
// renders as plain, unclickable text.
const SUPPORT_URL = null;

export default function FrontPage({ todayRound, todayTotal, todayInProgress, onPlay, onSettings }) {
  const date = todayRound?.date ?? todayDateString();
  const played = todayTotal != null;
  const seed = `front-page-${date}`;

  // Headline-less filler: just body text under each section's real headline.
  const sectionFiller = useMemo(
    () =>
      ['settings', 'support'].map((key) => [
        {
          headline: null,
          paragraphs: makeFillerStories(`${seed}:${key}`, 1, FILLER_PARAGRAPHS)[0].paragraphs,
          contd: makeContinuedPage(`${seed}:${key}:contd`),
        },
      ]),
    [seed]
  );

  const headline = !todayRound
    ? 'No Edition Today'
    : played
      ? `You Scored ${todayTotal.toLocaleString()} Points`
      : 'Can You Date the News?';

  const body = !todayRound ? (
    <p className="fp-deck">No issue is scheduled for today. Check back tomorrow for a new edition.</p>
  ) : (
    <>
      <p className="fp-deck">
        {played
          ? "That's today's edition done. A new one lands tomorrow."
          : `${todayRound.headlines.length} real headlines from the New York Times archives. Guess the year each one was printed.`}
      </p>
      <button type="button" className="primary-btn fp-play" onClick={onPlay}>
        {todayInProgress ? "Resume today's issue" : played ? 'Play again' : "Play today's issue"}
      </button>
    </>
  );

  return (
    <div className="newspaper-stage">
      <div className="newspaper-stage-inner">
        <Newspaper
          seed={seed}
          className="front-page"
          section="Front Page"
          issueLabel="Today's Edition"
          fixedLeadPosition={1}
          date={date}
          title="The Daily Headlines"
          lead={
            <p className="headline-text">
              <StampText text={headline} stagger={HEADLINE_STAMP_STAGGER} />
            </p>
          }
          guess={
            <>
              <div className="fp-body">{body}</div>
              <div className="fp-sections">
                <section className="fp-section">
                  <div className="fp-section-title">
                    <button type="button" className="fp-section-head" onClick={onSettings}>
                      Settings
                    </button>
                  </div>
                  <div className="fp-section-filler">
                    <FillerLayer stories={sectionFiller[0]} />
                  </div>
                </section>
                <section className="fp-section">
                  <div className="fp-section-title">
                    {SUPPORT_URL ? (
                      <a className="fp-section-head" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
                        Support the Developer
                      </a>
                    ) : (
                      <h3 className="fp-section-head is-placeholder">Support the Developer</h3>
                    )}
                  </div>
                  <div className="fp-section-filler">
                    <FillerLayer stories={sectionFiller[1]} />
                  </div>
                </section>
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}
