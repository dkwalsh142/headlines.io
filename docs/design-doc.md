# Headline Year-Guesser — Design Doc

## 1. Concept

A Timeguessr/Tradle-style game. Each round presents 5 real historical news headlines,
one at a time. The player guesses the publication year for each; points are awarded
based on how close the guess is. Rounds are **pre-scheduled**, one per day (like
Wordle), and the end-of-round screen shows the player's score against everyone else
who played that day's round.

## 2. Scope phasing

- **MVP**: Single source (NYT). Manually curated, locally-held backlog. One
  scheduled round per day. React web app for gameplay, static JSON data for
  content. A small backend for **same-day comparison only** — your score vs.
  everyone else who played today's round. No monetization, no personal/
  historical stats.
- **Post-MVP**: Additional headline sources beyond NYT (§8). Monetization — one-time
  $5 payment to unlock unlimited play (§9). Personal & all-time stats — history,
  weekly trend, monthly highlights (§10). Personal stats specifically depends on
  durable player identity, which only really starts to matter once monetization's
  device-linking exists (§10.3) — so it's deferred, not just deprioritized
  arbitrarily.

This doc covers MVP in full and sketches post-MVP additions so nothing in the MVP
architecture has to be undone later.

## 3. System overview

Three independent pieces:

```
[Content Pipeline]  (local, run by you)
   NYT fetch → curate (review/rate/approve/tag section) → approved.json
                                                      │
                                                      ▼
[Round Scheduler]  (local, run by you, ahead of time)
   approved.json → schedule-rounds.js → rounds.json (one dated round per day)
                                                      │
                                                      ▼
[Game]  (React app, ships to players)          [Stats Service]  (small backend)
   rounds.json → today's round → play  ───POST result───▶  stores + aggregates
        ▲                                                        │
        └──────────────── GET today's aggregate ◀────────────────┘
```

Content curation and scheduling stay exactly as before: local tools, static JSON,
low write frequency, no server needed. The only live, server-backed piece in MVP is
the stats service, and in MVP it does one job: same-day aggregate comparison.

## 4. Content pipeline (local)

### 4.1 Fetching
- `fetch-nyt.js` — pulls from NYT Archive API (bulk, by month/year) and/or Article
  Search API (targeted). Writes raw dumps to `data/raw/nyt_<year>.json`, one file
  per year so nothing is re-fetched.
- Every record is tagged `"source": "nyt"` from day one, even though NYT is the
  only source in MVP — this is what makes adding sources later free instead of a
  refactor (§8).
- Raw dumps feed directly into curation (§4.2) — no automated filter/dedup pass.
  Since every headline gets manually reviewed anyway, an automated pre-filter
  would mostly be solving a problem (obvious junk, duplicates) that a human
  glancing at the list catches naturally, without the risk of a bad regex
  silently dropping a perfectly good headline before you ever see it. Revisit
  this if the raw volume ever gets large enough that manual review of everything
  becomes the bottleneck — worth noting as a "if this stops being MVP-scale"
  tripwire rather than solving preemptively.

### 4.2 Curation
- `curate.js` — a local CLI (not a shipped UI) that shows one raw headline at a
  time. You reject the obvious junk (year-in-headline giveaways, wire-service
  stubs, near-duplicates) as part of the same pass where you rate difficulty 1–5,
  approve, and tag a **section** — one review step instead of two.
- Section taxonomy (confirmed): use real newspaper desk names, not free-form tags —
  `politics`, `world`, `business`, `sports`, `arts`, `science`, `opinion`,
  `style`/`lifestyle`. Fixed vocabulary, not open-ended, so it can drive both round
  variety (§5) and UI theming (§6.3) consistently. Add sections only deliberately,
  not per-headline.
- Approved items move to `data/approved.json`.

### 4.3 Backlog data shape

```json
{
  "id": "nyt-1987-04-12-a1",
  "source": "nyt",
  "text": "Reagan Warns Soviets Over Missile Deployment",
  "year": 1987,
  "section": "politics",
  "sourceUrl": "https://nyt.com/...",
  "difficulty": 3,
  "usedInRounds": [],
  "avgGuessError": null
}
```

`usedInRounds` lets the scheduler enforce a reuse cooldown. `avgGuessError` stays
null until the stats service starts feeding real guess data back into it (§7.4).

## 5. Round scheduler (local, ahead-of-time)

Cadence confirmed: **one global round per day**, same round for every player, like
Wordle. This matters for stats — "vs. everyone else today" only makes sense if
everyone is playing the same 5 headlines.

- `schedule-rounds.js` — run periodically (e.g. monthly) to generate a batch of
  future dated rounds from the current `approved.json` backlog.
- Selection rules per round:
  - 5 headlines, no two from the same decade if avoidable
  - Mixed difficulty (e.g. target [easy, easy, medium, medium, hard])
  - Mixed sections where possible — avoids an accidental all-politics round and
    gives the round a bit of natural variety in tone
  - Respect a reuse cooldown against `usedInRounds`
- Output: `data/rounds.json`

```json
{
  "id": "round-2026-09-15",
  "date": "2026-09-15",
  "headlines": [
    { "id": "nyt-1987-04-12-a1", "section": "politics" },
    { "id": "nyt-1963-09-02-b7", "section": "sports" }
  ]
}
```

- Backlog running low is a checkable failure state: if the scheduler can't satisfy
  the next N days under the cooldown + section-mix constraints, it should fail
  loudly rather than quietly reuse headlines too soon.
- "Day" boundary needs a fixed definition (e.g. midnight UTC, or a fixed timezone)
  since the round — and its stats — are shared globally. Worth picking this
  explicitly rather than letting it default to server-local time.

## 6. Game (React app)

### 6.1 Data loading
`rounds.json` (or just today's + upcoming entries) and the headline records they
reference ship as static JSON, bundled or fetched. "Today's round" = look up
`rounds.json` by today's date (per the fixed day-boundary above). No backend
involved in loading the round itself — only in submitting/reading stats.

### 6.2 Game loop
`idle → showing_headline → awaiting_guess → revealing → next_headline |
round_complete`.

### 6.3 Scoring & theming
- Distance-based decay: max points (e.g. 1000) at exact year, falling off with
  `|guess - actual|` via an exponential/piecewise curve, tuned to your backlog's
  actual year range.
- Section tagging (§4.3) drives lightweight per-headline theming — e.g. a small
  icon/accent color per section (arts vs. politics vs. sports) on the headline
  card. Purely cosmetic, no gameplay effect, but it's essentially free once
  section is a first-class field, and it reinforces the "newspaper" feel.

### 6.4 End-of-round screen (MVP scope: same-day only)
This is where the daily comparison lives:
- Player's total score and per-headline breakdown (guess vs. actual year).
- Day's aggregate: average score, and where the player lands relative to it —
  e.g. "You beat 72% of today's players" and/or a simple distribution bar.
- This screen is the *only* place in the game that talks to the stats service —
  everything before it is pure local state.
- No personal history, no all-time table, no weekly trend in MVP — see §10 for
  that scope, deferred post-MVP.

## 7. Stats service (MVP — small backend, same-day comparison only)

### 7.1 Why this can't stay static
"Vs. everyone else that day" requires a shared, continuously updated view of every
player's result for the current round. A file bundled with the app is fixed at
build time and can't reflect players' results as they come in. This is the one
place the MVP needs a live server component.

### 7.2 Player identity (lightweight, no accounts in MVP)
- **Self-assigned, not derived from anything.** No hidden browser/device
  signature is available or used — deliberately avoiding fingerprinting (privacy
  cost, legal weight, and unreliable anyway under modern browser tracking
  protections). The ID is generated by the client and means nothing on its own:
  ```js
  function getPlayerId() {
    let id = localStorage.getItem('playerId');
    if (!id) {
      id = crypto.randomUUID();       // fallback needed for older browsers
      localStorage.setItem('playerId', id);
    }
    return id;
  }
  ```
- Persists via `localStorage` (disk-backed, no expiry) across sessions, tab
  closes, and restarts — but is scoped to one `(origin, browser profile)` pair.
  Lost on manual site-data clearing, browser switch, device switch, or private/
  incognito windows (fresh storage each time).
- No login, no PII. Good enough to prevent someone trivially re-submitting the
  same round twice from the same browser, not intended as strong anti-cheat.
- In MVP this ID is used once per round and discarded from the server's
  perspective after the aggregate is updated — no per-player record is kept
  (that's the post-MVP change in §10). It's deliberately the same mechanism the
  monetization unlock (§9) will later want, so building it now doesn't need to be
  redone.

### 7.3 Data flow
- On round completion, client `POST`s a result:
  ```json
  {
    "roundId": "round-2026-09-15",
    "playerId": "anon-9f3a...",
    "score": 3820,
    "guesses": [
      { "headlineId": "nyt-1987-04-12-a1", "guessedYear": 1985, "points": 940 }
    ]
  }
  ```
- Server stores the raw result and updates a **per-round aggregate** (not
  computed fresh from scratch on every read — see below).
- Client `GET`s the aggregate for `roundId` to render the comparison on the
  end-of-round screen.

### 7.4 Aggregate computation
At this game's scale, don't query/scan all raw results on every page load — keep a
running aggregate per round, updated incrementally on each submission:
- count, sum, sum-of-squares (→ mean, stddev)
- a coarse score histogram (fixed buckets, e.g. every 500 points) → cheap
  approximate percentile ("you beat ~72%") without an exact rank query
- optionally, per-headline aggregate guess error — this is the `avgGuessError`
  feedback loop from §4.3, and it's fine to include in MVP since it's just another
  field on the same aggregate, not a new personal-tracking concern.

### 7.5 Storage
Raw results and aggregates need real persistent storage with concurrent writes —
a flat JSON file won't hold up under many players submitting at once. This is a
different storage need than the backlog/rounds data (which stays static JSON,
low-frequency, curated by you) — don't conflate the two. A minimal hosted
KV/DB (e.g. a small managed Postgres, Redis, or a serverless-friendly store) behind
a couple of endpoints is enough; this does not need to be a full application
backend.

## 8. Post-MVP: additional sources

Because every backlog record already carries `source` and a source-native `id`
prefix, adding a second source means: a new `fetch-<source>.js` outputting to the
same `data/raw/` shape, with any source-specific fetch quirks contained there.
`curate.js`, the scheduler, and the game are all already source-agnostic. No
change needed downstream.

## 9. Post-MVP: monetization (Krillion-style, one-time $5 unlock)

Sketch only — not building yet.

- **Model**: free tier gets limited play (e.g. today's round only); a one-time $5
  payment unlocks unlimited play (e.g. the full past-rounds archive).
- **Identity shifts from device-local to email-based at the point of purchase.**
  The anonymous `playerId` from §7.2 is fine for stats (nothing valuable to
  protect), but paid unlock needs to survive a lost/cleared/new device, so it's
  tied to an email rather than to `localStorage`:
  - At checkout, capture email. On successful payment, create an **account**
    record keyed by email, with an unlock flag.
  - Each device that wants access "links" itself to that account (e.g. player
    enters their email, gets a magic link or short code, device gets registered).
    Under the hood this associates the device's local `playerId` with the
    account.
  - **Device cap**: account record holds a bounded list of linked device/
    `playerId` entries (e.g. cap at 3–5). Linking a new device once at the cap
    either fails with a clear message, or requires unlinking an existing device
    first — needs a simple self-serve "manage devices" view so this isn't a
    support-ticket-only path.
- **Data model addition** (new, alongside the stats tables — same backend,
  no new service):
  ```
  accounts
  - email
  - unlocked: bool
  - stripeCustomerId
  - linkedDevices: [ { playerId, linkedAt, label? } ]  (bounded length)
  ```
- Flow: Stripe one-time checkout (collects email) → webhook creates/updates the
  `accounts` record, sets `unlocked: true` → device linking step registers the
  current `playerId` into `linkedDevices` → round-access check
  (`getAvailableRounds(playerId)`) looks up whether that `playerId` is linked to
  an unlocked account.
- Gate still lives at the round-lookup layer (§6.1's seam), it just now checks
  account status via the linked device instead of a flag on `playerId` directly.
- This is the one part of the design where "no accounts" (§7.2) stops being true
  — but only for paying users, and only introduced when monetization is actually
  built, not in MVP.

## 10. Post-MVP: personal & all-time stats (Thrice-style)

Explicitly **not in MVP**. MVP's stats service (§7) only ever produces same-day
aggregates and forgets the player afterward. Everything below is deferred.

### 10.1 What it adds
Beyond same-day comparison, a dedicated **Stats screen**, viewable anytime, not
just right after finishing today's round:
- **All-time table, broken down by section**: for each section (politics, arts,
  sports, ...), your performance vs. the global average, bucketed into
  **accuracy bands** based on guess error (our analog to Thrice's clue-tier
  columns, since our answer is a numeric year, not a revealed clue):
  `exact` (0 years off), `close` (1–5), `medium` (6–15), `far` (16+).
- **Monthly highlights**: toughest/easiest question of the month — the headline
  with the highest/lowest average guess error that month. A batch job or lazy
  query over §7.4's existing per-headline aggregates — no new data collection.
- **Weekly overview**: your score per day for the last 7 days (bar) against the
  daily average score (line) — reuses §7.4's per-round aggregate (line) plus the
  player's own result history (bars).

### 10.2 What it requires that MVP doesn't
A running per-player record, not just a fire-and-forget submission:

```
playerStats (keyed by playerId)
- totalRoundsPlayed
- perSection: {
    politics: { exact: n, close: n, medium: n, far: n, avgError },
    arts:     { exact: n, close: n, medium: n, far: n, avgError },
    ...
  }
- history: [ { roundId, date, score } ]   (bounded — e.g. keep last ~90 days,
                                            enough for weekly view + some margin)
```

Updated incrementally on each submission, same pattern as §7.4's aggregate — this
slots into the same write path, it's not a redesign of it.

### 10.3 Why this depends on §9, not just §7
Without device linking, losing/clearing `playerId` silently drops a whole
`playerStats` record with no recovery path — which makes personal stats fragile
in a way same-day comparison isn't (losing that just means missing one day's
percentile, no real loss). This is why personal stats is sequenced after
monetization's device-linking work rather than built independently: linking is
what makes a history worth having. Worth deciding whether linking/accounts should
exist as a free feature on its own, separate from the $5 unlock, once this phase
is reached — see open questions.

## 11. Open questions / decisions to revisit

- **Cadence** — resolved: one global round/day.
- **Section taxonomy** — resolved: fixed newspaper-desk vocabulary
  (politics/world/business/sports/arts/science/opinion/style).
- **End state screen** — resolved: same-day comparison surfaces here in MVP;
  personal stats surfaces are post-MVP (§10).
- **Monetization structure** — still TBD; §9 is a sketch, not a decision. Within
  it, still open: exact device cap number, whether linking requires a real
  email-verification step (magic link) or something lighter (short code, less
  secure but simpler), and whether a removed device can immediately be
  replaced or has a cooldown (to deter cap-cycling as a workaround for sharing
  one purchase across many people).
- Day-boundary timezone for "what counts as today's round" — needs an explicit
  choice (§5).
- Anti-abuse on stats submission: is device-local `playerId` + one-submission-per-
  round-per-ID good enough for MVP, or does it need a server-side check too
  (e.g. reject a second submission for the same `roundId`/`playerId` pair)?
- Histogram bucket width for the score distribution — needs tuning once the
  scoring curve (§6.3) is finalized, since bucket size should relate to the real
  spread of possible scores.
- Accuracy band thresholds (§10.1) — is exact/close(1–5)/medium(6–15)/far(16+)
  the right split, or should it be tuned once real guess-error data exists?
- How far back does personal history need to go, once §10 is built? Weekly view
  only needs ~7 days, but an all-time table implies keeping (at least aggregated)
  data indefinitely.
- Is a free, unlinked-but-persistent local history (just `localStorage`, no
  server account) worth supporting as a middle ground before someone links an
  email, or does history only start counting once they've linked a device?
