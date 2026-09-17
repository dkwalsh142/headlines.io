#!/bin/bash
# One-shot remote scoring: rsync pipeline/data/raw up to a remote machine with
# more memory/GPU headroom than this Mac, run score-decades.js there against
# its own Ollama instance, then rsync the results back down.
#
# Why: qwen2.5:14b (~9GB resident) plus normal daily use pushed this Mac's
# 16GB into repeated swap-thrashing/hangs during long scoring runs. The
# remote machine has 128GB RAM and a 48GB GPU, so it runs comfortably and
# much faster — this script keeps the heavy compute off this machine entirely.
#
# Usage: ./src/remote-score.sh [duration_seconds]
#   duration_seconds: how long to let scoring run remotely before stopping
#                      and syncing back (default 1800 = 30 min). Pass a large
#                      number (e.g. 36000) for an overnight run.

set -euo pipefail

REMOTE_HOST="dkwalsh@isc2357-12.cs.wm.edu"
REMOTE_DIR="~/headlines-scoring"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DURATION="${1:-1800}"

# Refuse to run alongside the local curation UI: the sync-down at the end
# overwrites data/raw/ wholesale, which would silently discard any manual
# reject/approve made locally while remote scoring was in flight.
if pgrep -f 'curate-ui-server.js' > /dev/null 2>&1; then
  echo "ERROR: curate-ui-server.js is currently running." >&2
  echo "Stop it first (pkill -f curate-ui-server.js) — this script's sync-down" >&2
  echo "will overwrite data/raw/ and could discard local changes made while" >&2
  echo "the curation UI is open." >&2
  exit 1
fi

echo "=== 1/4: Syncing pipeline code + raw data up to $REMOTE_HOST ==="
ssh -o BatchMode=yes "$REMOTE_HOST" "mkdir -p $REMOTE_DIR/src $REMOTE_DIR/data/raw"
rsync -az --progress \
  "$LOCAL_DIR/src/curationStore.js" \
  "$LOCAL_DIR/src/score-headlines.js" \
  "$LOCAL_DIR/src/score-decades.js" \
  "$REMOTE_HOST:$REMOTE_DIR/src/"
rsync -az --progress "$LOCAL_DIR/data/raw/" "$REMOTE_HOST:$REMOTE_DIR/data/raw/"

# Minimal package.json so score-decades.js's relative imports resolve as ESM.
ssh -o BatchMode=yes "$REMOTE_HOST" "cat > $REMOTE_DIR/package.json" <<'EOF'
{ "name": "headlines-remote-scoring", "private": true, "type": "module" }
EOF

echo ""
echo "=== 2/4: Starting score-decades.js on remote (will run for ${DURATION}s) ==="
# Runs inside a detached tmux session, NOT plain nohup/disown. This machine
# has Linger=no (systemd default for a shared login node), which means
# systemd kills every process belonging to a user the moment their last SSH
# session closes — nohup/disown/& do not protect against this, only surviving
# in a session type (tmux/screen) that systemd treats as a persistent login
# keeps the process alive after this script's SSH connection ends.
ssh -o BatchMode=yes "$REMOTE_HOST" "cd $REMOTE_DIR && tmux kill-session -t headlines-scoring 2>/dev/null; tmux new-session -d -s headlines-scoring 'node src/score-decades.js --batch-size=20 > score-decades.log 2>&1'"

# If this script is interrupted (Ctrl+C) during the sleep below, still stop
# the remote job and sync back whatever it managed to score — rather than
# leaving an orphaned remote process and losing that window's progress.
stop_and_sync() {
  echo ""
  echo "=== Stopping remote scoring and syncing results back (interrupted or finished) ==="
  ssh -o BatchMode=yes "$REMOTE_HOST" "tmux kill-session -t headlines-scoring 2>/dev/null; echo stopped"
  ssh -o BatchMode=yes "$REMOTE_HOST" "cd $REMOTE_DIR && tail -20 score-decades.log"
  echo ""
  echo "Syncing results back down..."
  rsync -az --progress "$REMOTE_HOST:$REMOTE_DIR/data/raw/" "$LOCAL_DIR/data/raw/"
  echo ""
  echo "Done. Remote scoring session complete, results synced to $LOCAL_DIR/data/raw/"
}
trap stop_and_sync EXIT

echo "Scoring started remotely (tmux session 'headlines-scoring'). Waiting up to ${DURATION}s (Ctrl+C to stop early and sync now)..."
echo "(Polling every 30s — if the remote job finishes on its own before ${DURATION}s is up, this returns immediately.)"

# Poll instead of a flat sleep so the caller (overnight-run.sh) can tell
# "scoring genuinely finished this month's backlog" apart from "we just ran
# out of allotted time" — the exit code/echoed status below is the signal.
ELAPSED=0
POLL_INTERVAL=30
FINISHED_NATURALLY=0
while [ "$ELAPSED" -lt "$DURATION" ]; do
  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
  if ! ssh -o BatchMode=yes "$REMOTE_HOST" "tmux has-session -t headlines-scoring 2>/dev/null"; then
    FINISHED_NATURALLY=1
    echo "Remote scoring session ended on its own after ${ELAPSED}s — backlog is fully scored."
    break
  fi
done
if [ "$FINISHED_NATURALLY" -eq 0 ]; then
  echo "Reached the ${DURATION}s time budget — stopping remote scoring now (backlog not necessarily finished)."
fi
echo "REMOTE_SCORE_FINISHED_NATURALLY=$FINISHED_NATURALLY"
