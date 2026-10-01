import { useMemo, useState } from 'react';
import { todayDateString } from './dateUtils.js';
import { formatPlayDate } from './formatDate.js';
import { Masthead } from './Newspaper.jsx';
import { loadScoreEntries } from './scoreStore.js';
import { computeStats } from './stats.js';
import TornFrame from './TornFrame.jsx';
import './Newspaper.css';

// The player's personal stats as one more newspaper page: a row of headline
// figures (a score row, then the rest); average points by decade and by section as
// two column charts side by side; then the recent editions across the bottom. Both charts are
// single-series (one hue, value on each column's cap) with a readout line
// under the chart that follows hover, tap, and keyboard focus.

const MAX_POINTS_PER_HEADLINE = 1000; // matches scoring.js MAX_POINTS
const RECENT_SLOTS = 7; // stats.js returns up to this many recent editions

// Decades shown even with no plays yet, so the timeline never skips: the
// game's headlines span 1900 to today.
const FIRST_DECADE = 1900;

const fmt = (n, digits = 0) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

// `totalIssues`: every issue created so far (rounds.json), for "of N".
// Renders just the paper; App supplies the page stage and the header row
// ("Your stats" + Back) around it.
export default function StatsPage({ totalIssues }) {
  const today = todayDateString();
  const stats = useMemo(() => computeStats(loadScoreEntries(), today), [today]);

  return (
    <TornFrame seed="stats-page" className="newspaper stats-paper" aria-label="Your stats">
      <Masthead title="The Daily Headlines" left="Your Record" center="Statistics" right={formatPlayDate(today)} />

      {stats ? (
        <>
          <div className="sp-tiles sp-tiles-secondary">
            <StatTile label="Average score" value={fmt(stats.averageScore)} sub="of 5,000" />
            <StatTile label="Best score" value={fmt(stats.best.total)} sub={formatPlayDate(stats.best.date)} />
          </div>
          <div className="sp-tiles">
            <StatTile
              label="Day streak"
              value={fmt(stats.currentStreak)}
              sub={`Longest: ${fmt(stats.longestStreak)}`}
            />
            <StatTile
              label="Average miss"
              value={stats.avgMiss == null ? '—' : fmt(stats.avgMiss, 1)}
              sub="years off"
            />
            <StatTile label="Exact years" value={fmt(stats.exactGuesses)} sub="on the nose" />
            <StatTile
              label="Issues played"
              value={fmt(stats.played)}
              sub={totalIssues ? `of ${fmt(totalIssues)}` : undefined}
            />
          </div>

          <div className="sp-charts">
            <section className="sp-col">
              <h3 className="sp-head">By Decade</h3>
              <ColumnChart
                slots={decadeSlots(stats.byDecade)}
                caption="Average points per headline, by the decade it ran"
                narrow
              />
            </section>
            <section className="sp-col">
              <h3 className="sp-head">By Section</h3>
              <ColumnChart
                slots={stats.bySection.map((row) => ({ key: row.key, label: row.label, row }))}
                caption="Average points per headline"
              />
            </section>
          </div>

          <section className="sp-recent">
            <h3 className="sp-head">Recent Editions</h3>
            <ol className="sp-recent-list">
              {stats.recent.map((r) => (
                <li key={r.date} className="sp-recent-item">
                  <span className="sp-recent-date">{formatPlayDate(r.date)}</span>
                  <span className="sp-recent-score">{fmt(r.total)}</span>
                </li>
              ))}
              {/* Always 7 slots: unfilled ones keep their dividing line
                  (and height, via the non-breaking spaces) but stay empty. */}
              {Array.from({ length: Math.max(0, RECENT_SLOTS - stats.recent.length) }, (_, i) => (
                <li key={`empty-${i}`} className="sp-recent-item" aria-hidden="true">
                  <span className="sp-recent-date">&nbsp;</span>
                  <span className="sp-recent-score">&nbsp;</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <div className="sp-empty">
          <h3 className="headline-text">No Editions On Record</h3>
          <p className="fp-deck">Finish an issue and your scores, streaks, and breakdowns will appear here.</p>
        </div>
      )}
    </TornFrame>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="sp-tile">
      <div className="sp-tile-label">{label}</div>
      <div className="sp-tile-value">{value}</div>
      {sub && <div className="sp-tile-sub">{sub}</div>}
    </div>
  );
}

// Every decade from 1900 to now, oldest first. Decades with no headlines
// yet keep their slot, just without a column.
function decadeSlots(rows) {
  if (!rows.length) return [];
  const byDecade = new Map(rows.map((r) => [r.key, r]));
  const first = Math.min(FIRST_DECADE, ...byDecade.keys());
  const last = Math.max(Math.floor(new Date().getUTCFullYear() / 10) * 10, ...byDecade.keys());
  const slots = [];
  for (let d = first; d <= last; d += 10) {
    slots.push({ key: d, label: `${d}s`, row: byDecade.get(d) ?? null });
  }
  return slots;
}

// The pixel font is monospaced, so its comma gets a full digit's width;
// wrapping it lets CSS tuck it in (e.g. a column capped "1,000").
function tuckCommas(text) {
  return text.split(',').flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="sp-comma">,</span>, part]));
}

function describe(slot) {
  const { row } = slot;
  if (!row) return `${slot.label}: no headlines yet`;
  const headlines = `${row.count} headline${row.count === 1 ? '' : 's'}`;
  return `${slot.label}: ${fmt(row.avgPoints)} pts · ${headlines} · ${fmt(row.avgMiss, 1)} yrs off`;
}

// Single-series columns, 0–1,000 points: one slot per category, value on
// the column's cap. The readout line under the chart shows the hovered /
// tapped / focused slot's details (headline count, average miss); a fixed
// line instead of a floating tooltip so nothing gets clipped by the paper's
// torn edge or the chart's sideways scroll on narrow screens. `narrow` packs
// the slots tighter with diagonal labels (for the 13-decade timeline).
function ColumnChart({ slots, caption, narrow = false }) {
  const [active, setActive] = useState(null);

  if (!slots.length) {
    return <p className="sp-note">Finish an issue to see this breakdown.</p>;
  }

  const activeSlot = slots.find((s) => s.key === active);

  return (
    <div className="sp-chart">
      <p className="sp-caption">{caption}</p>
      <div className={['sp-timeline', narrow && 'is-narrow'].filter(Boolean).join(' ')}>
        <ul className={['sp-columns-chart', narrow && 'is-narrow'].filter(Boolean).join(' ')}>
          {slots.map((slot) => (
            <li
              key={slot.key}
              className={['sp-column-slot', active === slot.key && 'is-active'].filter(Boolean).join(' ')}
              tabIndex={0}
              aria-label={describe(slot)}
              onPointerEnter={() => setActive(slot.key)}
              onPointerLeave={() => setActive(null)}
              onClick={() => setActive(slot.key)}
              onFocus={() => setActive(slot.key)}
              onBlur={() => setActive(null)}
            >
              <span className="sp-column-plot">
                {slot.row && <span className="sp-column-value">{tuckCommas(fmt(slot.row.avgPoints))}</span>}
                {slot.row && (
                  <span
                    className="sp-column"
                    style={{ height: `${(slot.row.avgPoints / MAX_POINTS_PER_HEADLINE) * 100}%` }}
                  />
                )}
              </span>
              <span className="sp-column-label">
                <span className="sp-column-label-text">{slot.label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="sp-readout" aria-hidden="true">
        {activeSlot ? describe(activeSlot) : 'Hover or tap a column for details.'}
      </p>
    </div>
  );
}
