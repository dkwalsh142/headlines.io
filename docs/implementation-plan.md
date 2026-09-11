# Headline Year-Guesser — Implementation Plan

Companion to `design-doc.md`. That doc explains *what* and *why*; this one is
*build order*. MVP scope only — see design doc §2 for what's explicitly deferred
(personal/all-time stats, monetization, additional sources).

Each phase should be independently runnable/testable before moving to the next.
Phases 1–2 are local tools; Phase 3–4 is the shipped app; Phase 5 is glue + launch.

---

## Phase 0 — Project setup
- [ ] Repo structure per design doc §3: `/pipeline` (local scripts) and `/game`
      (React app) as separate top-level directories, not entangled.
- [ ] `.env`/config for NYT API key — never committed, pipeline-only, not exposed
      to the React app.
- [ ] Decide and document the day-boundary timezone (design doc §5, open
      question) — this affects the scheduler and the game's "today" lookup, so
      it should be a single shared constant, not decided twice in two places.

## Phase 1 — Content pipeline (local, no UI needed yet)
Goal: a working `approved.json` with a meaningful number of curated headlines.

- [ ] `fetch-nyt.js` — Archive API pull by month/year, writes to
      `data/raw/nyt_<year>.json`. Test on a single month first before bulk-running.
- [ ] `curate.js` — CLI: show one raw headline, reject/approve (catching junk and
      duplicates by eye as part of the same pass), accept difficulty 1–5 +
      section tag. Outputs to `data/approved.json`. No separate automated
      filter step — see design doc §4.1 for why that's deliberately skipped for
      now.
- [ ] **Milestone check**: manually curate enough headlines to cover several
      weeks of daily rounds (5/day) before moving on — Phase 2 can't be
      meaningfully tested against an empty or tiny backlog.

## Phase 2 — Round scheduler (local)
Goal: a `rounds.json` with real dated rounds, generated from Phase 1's backlog.

- [ ] `schedule-rounds.js` — selection logic: 5 headlines/round, decade spread,
      difficulty mix, section mix, cooldown against `usedInRounds`.
- [ ] Failure mode: script should error loudly (not silently degrade) if the
      backlog can't satisfy constraints for the requested date range.
- [ ] **Milestone check**: generate and eyeball a month of rounds. Look for
      lopsided difficulty, repeated sections back-to-back, anything that reads
      oddly before it's ever shown to a player.

## Phase 3 — Game shell (React, no stats yet)
Goal: playable end-to-end on a single device, no backend involved at all.

- [ ] Load `rounds.json`, resolve "today's round" by the fixed day boundary.
- [ ] Game state machine: `idle → showing_headline → awaiting_guess → revealing
      → next_headline → round_complete`.
- [ ] Scoring function: distance-decay curve, tuned against the actual year
      range present in the curated backlog (not a guessed range).
- [ ] Headline card UI with section-based theming (icon/accent color per
      section).
- [ ] End-of-round screen: score + per-headline breakdown. **No comparison data
      yet** — that's Phase 4. Screen should be built to accept it once available,
      not reworked later.
- [ ] **Milestone check**: playable start-to-finish with fake/seeded data,
      correct scoring, no crashes on round boundaries (first headline, last
      headline, replaying same day).

## Phase 4 — Stats service (small backend, same-day comparison only)
Goal: end-of-round screen shows real same-day comparison.

- [ ] Player ID: `crypto.randomUUID()` generated + stored in `localStorage` on
      first load (design doc §7.2 has the exact snippet).
- [ ] Storage setup: minimal hosted KV/DB, two shapes — raw `results` and
      per-round `roundAggregate` (count, sum, sum-of-squares, score histogram,
      per-headline avg error).
- [ ] `POST /results` endpoint — accepts a result, writes raw record, updates
      the round's aggregate incrementally (not full recompute).
- [ ] `GET /rounds/:id/aggregate` endpoint — returns the aggregate for the
      end-of-round screen to render (avg score, approximate percentile via
      histogram bucket).
- [ ] Wire into Phase 3's end-of-round screen.
- [ ] **Milestone check**: submit multiple results (multiple browsers/incognito
      windows count as multiple "players") and confirm the aggregate and
      percentile update correctly and match expectations by hand-calculation on
      a small sample.

## Phase 5 — Polish & launch readiness
- [ ] Handle the "no round for today" edge case gracefully (scheduler gap,
      deploy timing) rather than a blank/broken screen.
- [ ] Handle "already played today" — decide and implement the replay/return
      behavior (design doc §11 flags this as open; resolve it here).
- [ ] Basic abuse guard on `POST /results` — at minimum, reject a second
      submission for the same `(roundId, playerId)` pair server-side, not just
      client-side.
- [ ] Confirm day-boundary handling is correct across a real day transition
      (test near local midnight vs. the chosen fixed timezone).

---

## Explicitly out of scope for this plan
Per design doc §2/§8/§9/§10 — do not build in these phases:
- Additional headline sources beyond NYT
- Monetization / Stripe / accounts / device linking
- Personal stats, all-time tables, weekly trend charts, monthly highlights

These have design sketches already in `design-doc.md` for when they're picked up,
but pulling any of them into this build risks scope creep the phased structure
above is meant to avoid — particularly personal stats, which depends on
monetization's device-linking work per design doc §10.3 and shouldn't be started
before that foundation exists.
