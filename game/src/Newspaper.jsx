import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { makeContinuedPage, makeFillerStories } from './filler.js';
import { formatPlayDate } from './formatDate.js';
import { SECTION_LABEL } from './sections.js';
import CoffeeStains, { makeCoffeeStains } from './CoffeeStains.jsx';
import TornFrame from './TornFrame.jsx';
import './Newspaper.css';

// A single "physical newspaper page" for one headline. Static for now —
// no animation/typewriter/sound yet (see docs/plans), structured with one
// root element and slot props (lead/guess/children) so those are easy to
// layer on later without restructuring this component.
//
// Layout: masthead (paper title + issue number / section / play date row)
// above three side-by-side story columns: the real headline plus two fake
// "filler" stories. The headline column's position (left/middle/right) is
// picked at random on each mount; its space below the headline holds the
// `guess` UI, with `children` (the reveal) below it once passed in. At most
// one fake column is randomly a short story with a second one stacked below
// it; the other is one full-height story. Every fake story ends with its own
// "Cont'd on A5" jump line. Filler text is seeded from the `seed`
// prop (pass the headline's id) so it's stable across re-renders but
// distinct per headline.

// More paragraphs than a full-height column can hold; FillerLayer trims the
// excess so the text ends exactly where the column does.
export const FILLER_PARAGRAPHS = { minParagraphs: 6, maxParagraphs: 8 };
// First story of a two-story column — a single short paragraph, so the
// second story's headline lands mid-column with room for its text below.
const FILLER_PARAGRAPHS_SHORT = { minParagraphs: 1, maxParagraphs: 1, minSentences: 2, maxSentences: 2 };
// Chance that one (never both) of the fake columns is the two-story variant.
const TWO_STORY_CHANCE = 0.5;

// `issueLabel` overrides the masthead's "No. {issueNumber}"; `fixedLeadPosition`
// (0-2) pins the headline column instead of randomizing it; `showYear={false}`
// drops the year from the masthead date.
export default function Newspaper({
  seed,
  section,
  issueNumber,
  issueLabel,
  fixedLeadPosition,
  showYear = true,
  date,
  title,
  lead,
  guess,
  children,
  className,
}) {
  // Deliberately Math.random (not seeded): the arrangement reshuffles on
  // every load, but stays fixed for the life of this headline's page.
  const { leadPosition, twoStoryColumn, coffeeStains } = useMemo(
    () => ({
      leadPosition: Math.floor(Math.random() * 3),
      // Index of the one fake column that gets two stories, or -1 for none.
      twoStoryColumn: Math.random() < TWO_STORY_CHANCE ? Math.floor(Math.random() * 2) : -1,
      coffeeStains: makeCoffeeStains(),
    }),
    [seed]
  );
  const fillerStories = useMemo(() => {
    const story = (key, paragraphs) => ({
      ...makeFillerStories(`${seed}:${key}`, 1, paragraphs)[0],
      contd: makeContinuedPage(`${seed}:${key}:contd`),
    });
    return [0, 1].map((i) =>
      i === twoStoryColumn
        ? [story(`story-${i}`, FILLER_PARAGRAPHS_SHORT), story(`story-${i}b`, FILLER_PARAGRAPHS)]
        : [story(`story-${i}`, FILLER_PARAGRAPHS)]
    );
  }, [seed, twoStoryColumn]);

  const leadColumn = (
    <div className="np-column np-column-lead" key="lead">
      <div className="np-lead">{lead}</div>
      <div className="np-lead-below">
        {guess}
        {children}
      </div>
    </div>
  );
  const fillerColumns = fillerStories.map((stories, i) => (
    <div className="np-column np-column-filler" key={`filler-${i}`}>
      <FillerLayer stories={stories} />
    </div>
  ));
  const columns = [...fillerColumns];
  columns.splice(fixedLeadPosition ?? leadPosition, 0, leadColumn);
  const gridTemplateColumns = columns
    .map((col) => (col === leadColumn ? 'minmax(0, 2.2fr)' : 'minmax(0, 1fr)'))
    .join(' ');

  return (
    <TornFrame seed={seed} className={['newspaper', className].filter(Boolean).join(' ')} aria-label={title}>
      <Masthead
        title={title}
        left={issueLabel ?? `No. ${issueNumber}`}
        center={SECTION_LABEL[section] ?? section}
        right={formatPlayDate(date, { showYear })}
      />

      <div className="np-body" style={{ gridTemplateColumns }}>
        {columns}
      </div>

      {/* Last, so stains sit over the print like a real spill. */}
      <CoffeeStains stains={coffeeStains} />
    </TornFrame>
  );
}

// Pixel-art ornament flanking the paper's title: a spiral curl unwinding into
// a flowing line that swings out of the curl and settles level, finished with
// a small ball. Drawn spiral-on-the-left; the masthead places them so the
// spirals sit beside the title and the balls point outward. Rendered on the
// same 3px grid as the torn border (--pixel), in the fake stories' light
// body-text ink (see .np-flourish in Newspaper.css).
//
// To redraw it, edit the grid: '#' is a filled pixel, '.' is empty. Every
// row must be the same length; the size and the SVG follow automatically.
const FLOURISH = [
  '.....#########.......................',
  '...########.####.........######......',
  '..##...##.###.###.......##....######.',
  '.#.....#....##.####...##.......#...##',
  '##.....##.....##.###.##........#....#',
  '#.......#......##.####........##....#',
  '##...............######......##.....#',
  '##................##.#########.....##',
  '.##.................##.#####......##.',
  '..#######............#####.....###...',
];

const FLOURISH_W = FLOURISH[0].length;
const FLOURISH_H = FLOURISH.length;
// One rectangle per horizontal run of '#'s.
const FLOURISH_PATH = FLOURISH.flatMap((row, y) =>
  [...row.matchAll(/#+/g)].map((run) => `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`)
).join('');

function MastheadFlourish({ mirrored = false }) {
  return (
    <svg
      className={['np-flourish', mirrored && 'is-mirrored'].filter(Boolean).join(' ')}
      viewBox={`0 0 ${FLOURISH_W} ${FLOURISH_H}`}
      // One grid pixel = one --pixel on screen, whatever size the grid is.
      style={{ width: `calc(${FLOURISH_W} * var(--pixel))`, height: `calc(${FLOURISH_H} * var(--pixel))` }}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path fill="currentColor" d={FLOURISH_PATH} />
    </svg>
  );
}

// Paper title over a left / center / right dateline row, then the double
// rule. Shared with ResultsPaper so every page of the issue matches.
export function Masthead({ title, left, center, right }) {
  return (
    <>
      <header className="np-masthead">
        <h2 className="np-title">
          {/* Spirals face the title; the balls point out toward the paper's edges. */}
          <MastheadFlourish mirrored />
          <span className="np-title-text">{title}</span>
          <MastheadFlourish />
        </h2>
        <div className="np-dateline">
          <span className="np-issue">{left}</span>
          <span className="np-section">{center}</span>
          <span className="np-date">{right}</span>
        </div>
      </header>
      <div className="np-double-rule" aria-hidden="true" />
    </>
  );
}

// Renders a fake column's stories trimmed to fit its height. Each story's
// text ends with its own "Cont'd on A5" jump line; the last visible story is
// cut short to make it fit. `fit` = { paragraph, words }: the index (across
// all stories) of the last paragraph shown and how many of its words to
// keep; null = show everything; paragraph -1 = nothing fits, show nothing.
// A story with no `headline` renders as body text only.
export function FillerLayer({ stories }) {
  const layerRef = useRef(null);
  const measureRef = useRef(null);
  const [fit, setFit] = useState(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const source = measureRef.current;
    if (!layer || !source) return undefined;

    function measure() {
      const next = computeFit(layer, source);
      setFit((prev) =>
        prev?.paragraph === next?.paragraph && prev?.words === next?.words ? prev : next
      );
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    // Web fonts change text metrics once they finish loading.
    document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [stories]);

  if (!stories) return null;

  let paragraphIndex = 0;
  const visibleStories = [];
  for (const story of stories) {
    const paragraphs = [];
    for (const text of story.paragraphs) {
      const index = paragraphIndex++;
      if (fit && index > fit.paragraph) break;
      paragraphs.push(fit && index === fit.paragraph ? trimWords(text.split(' '), fit.words) : text);
    }
    if (paragraphs.length === 0) break;
    visibleStories.push({ ...story, paragraphs });
  }

  return (
    <div className="np-filler-layer" aria-hidden="true" ref={layerRef}>
      <FillerStories stories={visibleStories} />
      {/* Untrimmed copy, never shown: computeFit clones it to test trims
          without touching React-managed DOM. */}
      <FillerStories stories={stories} className="np-filler-measure" innerRef={measureRef} />
    </div>
  );
}

function FillerStories({ stories, className, innerRef }) {
  return (
    <div className={['np-filler-inner', className].filter(Boolean).join(' ')} ref={innerRef}>
      {stories.map((story, i) => (
        <div className="np-filler-story" key={i}>
          {story.headline && (
            <h3 className="np-filler-headline">
              <span className="np-filler-headline-text">{story.headline}</span>
            </h3>
          )}
          {story.paragraphs.map((p, j) => (
            <p className="np-filler-paragraph" key={j}>
              {p}
              {j === story.paragraphs.length - 1 && <span className="np-filler-contd">{story.contd}</span>}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

// First `count` words, ending with a period if the cut lands mid-sentence.
function trimWords(words, count) {
  const text = words.slice(0, count).join(' ');
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

// Finds the longest prefix of the text (whole paragraphs, then words of the
// last one) that fits the column, with the last visible story's jump line
// appended. Works on a throwaway clone of the untrimmed copy, laid out in
// the same box.
function computeFit(layer, source) {
  const clone = source.cloneNode(true);
  clone.classList.remove('np-filler-measure');
  clone.style.visibility = 'hidden';
  layer.appendChild(clone);

  try {
    const fits = () => clone.scrollHeight <= clone.clientHeight;
    if (fits()) return null;

    const paragraphs = [...clone.querySelectorAll('.np-filler-paragraph')];
    const storyOf = paragraphs.map((p) => p.closest('.np-filler-story'));
    const contdOf = new Map([...clone.querySelectorAll('.np-filler-story')].map((st) => [st, st.querySelector('.np-filler-contd')]));
    const texts = paragraphs.map((p) => p.firstChild.nodeValue.split(' '));

    // Show paragraphs [0..last], the last one cut to `words` words and ending
    // in its story's jump line. `last` only ever decreases, so removed
    // paragraphs never need restoring.
    function layout(last, words) {
      paragraphs.forEach((p, i) => {
        if (i > last) {
          p.remove();
          if (!storyOf[i].querySelector('.np-filler-paragraph')) storyOf[i].remove();
          return;
        }
        if (i === last) {
          p.firstChild.nodeValue = trimWords(texts[i], words);
          p.appendChild(contdOf.get(storyOf[i]));
        }
      });
    }

    for (let last = paragraphs.length - 1; last >= 0; last--) {
      layout(last, 1);
      if (!fits()) continue;
      let lo = 1;
      let hi = texts[last].length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        layout(last, mid);
        if (fits()) lo = mid;
        else hi = mid - 1;
      }
      return { paragraph: last, words: lo };
    }
    // Not even a headline plus one word fits: leave the space empty rather
    // than overflow it.
    return { paragraph: -1, words: 0 };
  } finally {
    clone.remove();
  }
}
