#!/bin/bash
# Overnight supervisor: fetches + remotely scores one month at a time
# (starting from --start-month, default 7=July), advancing to the next month
# only once the current one is fully fetched AND fully scored, and stopping
# automatically at a fixed wall-clock cutoff (default 10:00am local time).
#
# On ANY unexpected failure (fetch error other than NYT's expected 429 quota
# wall, remote scoring dying, SSH connectivity lost, etc.) this stops
# everything immediately and exits non-zero — by design, so a caller running
# this unattended (e.g. overnight while asleep) can also stop caffeinate and
# leave a clear log rather than silently doing something wrong for hours.
#
# Usage: ./src/overnight-run.sh [--start-month=7] [--stop-at="10:00"]

set -uo pipefail  # NOT -e: we need to inspect each step's exit code ourselves

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOP_AT="10:00"
MONTH=7

for arg in "$@"; do
  case "$arg" in
    --start-month=*) MONTH="${arg#*=}" ;;
    --stop-at=*) STOP_AT="${arg#*=}" ;;
  esac
done

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# The absolute deadline is computed ONCE here, at script startup, and never
# re-derived later. Earlier this resolved "today at STOP_AT, or tomorrow if
# that's already passed" fresh on every call — which is correct for a
# recurring daily alarm, but wrong for a one-shot run: if something (e.g. a
# stuck `sleep`, a long fetch pass) caused a later check to land after the
# original STOP_AT had already passed, the old logic silently rolled the
# deadline forward to the NEXT day's STOP_AT and kept running for another 24
# hours instead of stopping — the opposite of what a one-shot cutoff means.
STOP_EPOCH=$(date -j -f "%Y-%m-%d %H:%M" "$(date '+%Y-%m-%d') $STOP_AT" "+%s" 2>/dev/null)
NOW_EPOCH_AT_START=$(date "+%s")
if [ "$STOP_EPOCH" -le "$NOW_EPOCH_AT_START" ]; then
  # STOP_AT has already passed today relative to when this script was
  # launched (e.g. started at 11pm with --stop-at=10:00) — roll forward
  # exactly once, to the very next occurrence, fixed for the rest of this run.
  STOP_EPOCH=$(date -j -v+1d -f "%Y-%m-%d %H:%M" "$(date '+%Y-%m-%d') $STOP_AT" "+%s")
fi

# Seconds remaining until the fixed deadline computed above. Can go negative
# if called after the deadline has passed — callers check for <= 0.
seconds_until_stop() {
  echo $(( STOP_EPOCH - $(date "+%s") ))
}

# Waits up to $1 seconds, but in short 30s increments rather than one long
# `sleep N` — a single `sleep 1200` was observed hanging for 9+ hours on one
# overnight run for reasons that were never pinned down (the Mac never
# actually slept, per `pmset -g log` — caffeinate held its assertion the
# whole time), which blocked the deadline check for far longer than the sleep
# itself should allow. Polling in short steps means the absolute worst case
# for "how late can we notice the deadline passed" is bounded to about 30s
# instead of the full requested duration, even if one individual `sleep 30`
# were to misbehave the same way.
poll_sleep() {
  local total="$1"
  local step=30
  local elapsed=0
  while [ "$elapsed" -lt "$total" ]; do
    local remaining=$(seconds_until_stop)
    if [ "$remaining" -le 0 ]; then
      return 0
    fi
    local this_step=$step
    if [ "$((total - elapsed))" -lt "$step" ]; then
      this_step=$((total - elapsed))
    fi
    sleep "$this_step"
    elapsed=$((elapsed + this_step))
  done
}

fail() {
  log "FAILURE: $*"
  log "Stopping all headlines.io background processes (caffeinate, any lingering local jobs)."
  pkill -f 'caffeinate -s' 2>/dev/null
  pkill -f 'remote-score.sh' 2>/dev/null
  log "Stopped. Overnight run aborted — see the log above for what broke."
  exit 1
}

log "=== Overnight run starting: month=$MONTH, stop-at=$STOP_AT ==="

if pgrep -f 'curate-ui-server.js' > /dev/null 2>&1; then
  fail "curate-ui-server.js is running. Stop it first (pkill -f curate-ui-server.js) — remote-score.sh refuses to run alongside it to avoid clobbering local curation changes."
fi

while true; do
  remaining=$(seconds_until_stop)
  if [ "$remaining" -le 0 ]; then
    log "Reached stop time ($STOP_AT). Ending overnight run cleanly."
    break
  fi
  log "Time remaining until $STOP_AT: $((remaining / 60)) minutes."

  # --- Fetch this month for every year, retrying around NYT's quota wall ---
  log "--- Fetching month $MONTH (all sections A,B,C,D, all years) ---"
  while true; do
    remaining=$(seconds_until_stop)
    if [ "$remaining" -le 0 ]; then
      log "Reached stop time while still fetching month $MONTH. Ending overnight run cleanly (partial month is fine — it resumes correctly next time)."
      exit 0
    fi

    fetch_output=$(mktemp)
    STRICT_FETCH_ERRORS=1 node "$SCRIPT_DIR/fetch-all-years.js" --month="$MONTH" --sections=A,B,C,D 2>&1 | tee "$fetch_output"
    fetch_exit=${PIPESTATUS[0]}

    if [ "$fetch_exit" -ne 0 ]; then
      rm -f "$fetch_output"
      fail "fetch-all-years.js exited with an unexpected error while fetching month $MONTH (see output above)."
    fi

    if grep -q "MONTH_FULLY_FETCHED" "$fetch_output"; then
      rm -f "$fetch_output"
      log "Month $MONTH fully fetched for all years."
      break
    fi
    rm -f "$fetch_output"

    # Hit NYT's quota wall — this is expected. Wait for it to trickle-refill
    # before retrying, same pattern used interactively earlier in this project.
    # Cap the wait to whatever time is actually left so this can't sleep past
    # the stop time — re-check right after waking, same as the top of this loop.
    remaining=$(seconds_until_stop)
    if [ "$remaining" -le 0 ]; then
      log "Reached stop time right after hitting the quota wall. Ending overnight run cleanly (partial month resumes correctly next time)."
      exit 0
    fi
    wait_seconds=1200
    if [ "$remaining" -lt "$wait_seconds" ]; then
      wait_seconds=$remaining
    fi
    log "Hit NYT's quota wall — waiting $((wait_seconds / 60)) minute(s) before retrying the fetch (capped by stop time)."
    poll_sleep "$wait_seconds"
  done

  # --- Score this month remotely until the backlog is genuinely exhausted ---
  log "--- Remote-scoring month $MONTH (this also scores any other unscored backlog) ---"
  remaining=$(seconds_until_stop)
  if [ "$remaining" -le 0 ]; then
    log "Reached stop time before starting remote scoring. Ending overnight run cleanly."
    exit 0
  fi

  score_output=$(mktemp)
  "$SCRIPT_DIR/remote-score.sh" "$remaining" 2>&1 | tee "$score_output"
  score_exit=${PIPESTATUS[0]}

  if [ "$score_exit" -ne 0 ]; then
    rm -f "$score_output"
    fail "remote-score.sh exited with an unexpected error while scoring month $MONTH (see output above)."
  fi

  finished_naturally=$(grep -o 'REMOTE_SCORE_FINISHED_NATURALLY=[01]' "$score_output" | tail -1 | cut -d= -f2)
  rm -f "$score_output"

  if [ "$finished_naturally" != "1" ]; then
    log "Ran out of time budget mid-scoring for month $MONTH. Ending overnight run cleanly (progress is saved; re-run to continue)."
    break
  fi

  log "Month $MONTH fully scored. Advancing to next month."
  MONTH=$((MONTH + 1))
  if [ "$MONTH" -gt 12 ]; then
    log "Wrapped past December — all 12 months are now fully fetched and scored. Stopping (nothing more to do)."
    break
  fi
done

log "=== Overnight run finished normally. Stopping caffeinate. ==="
pkill -f 'caffeinate -s' 2>/dev/null
exit 0
