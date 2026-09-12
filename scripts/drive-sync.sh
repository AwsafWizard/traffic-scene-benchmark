#!/usr/bin/env bash
# Keeps a local folder in step with a Google Drive folder, so the benchmark's
# folder sync has a real directory to read and write.
#
# Google ships no Drive client for Linux, so this uses rclone. Run:
#
#   ./scripts/drive-sync.sh setup     one-time: authorise your Google account
#   ./scripts/drive-sync.sh start     begin syncing in the background
#   ./scripts/drive-sync.sh once      sync a single time and exit
#   ./scripts/drive-sync.sh status    show what is configured and running
#   ./scripts/drive-sync.sh stop      stop background syncing
#
# The app never talks to Google — it only reads and writes LOCAL_DIR.

set -euo pipefail

REMOTE="${BENCH_REMOTE:-gdrive}"          # rclone remote name
REMOTE_DIR="${BENCH_REMOTE_DIR:-traffic-bench}"   # folder inside Drive
LOCAL_DIR="${BENCH_LOCAL_DIR:-$HOME/gdrive/traffic-bench}"
INTERVAL="${BENCH_SYNC_INTERVAL:-20}"     # seconds between passes
PIDFILE="/tmp/traffic-bench-drive-sync.pid"
LOGFILE="/tmp/traffic-bench-drive-sync.log"

RCLONE="$(command -v rclone || echo "$HOME/.local/bin/rclone")"

need_rclone() {
  if [ ! -x "$RCLONE" ]; then
    echo "rclone not found. Install it with:" >&2
    echo "  curl https://rclone.org/install.sh | sudo bash" >&2
    exit 1
  fi
}

case "${1:-}" in
  setup)
    need_rclone
    echo "A browser window will open so you can authorise YOUR Google account."
    echo "Choose:  n) New remote  ->  name: $REMOTE  ->  storage: drive"
    echo "Leave client_id and client_secret blank, pick scope 1 (full access),"
    echo "skip the advanced config, and answer 'y' to use a web browser."
    echo
    "$RCLONE" config
    echo
    echo "Creating $REMOTE:$REMOTE_DIR and $LOCAL_DIR …"
    "$RCLONE" mkdir "$REMOTE:$REMOTE_DIR"
    mkdir -p "$LOCAL_DIR"
    echo
    echo "Done. Paste this path into the app's Transfer page:"
    echo "  $LOCAL_DIR"
    ;;

  once)
    need_rclone
    # bisync needs one --resync pass to establish a baseline.
    if [ ! -d "$HOME/.cache/rclone/bisync" ] || \
       ! ls "$HOME/.cache/rclone/bisync" >/dev/null 2>&1 || \
       [ -z "$(ls -A "$HOME/.cache/rclone/bisync" 2>/dev/null)" ]; then
      echo "First run — establishing baseline with --resync"
      "$RCLONE" bisync "$LOCAL_DIR" "$REMOTE:$REMOTE_DIR" --resync --create-empty-src-dirs
    else
      "$RCLONE" bisync "$LOCAL_DIR" "$REMOTE:$REMOTE_DIR" --create-empty-src-dirs
    fi
    ;;

  start)
    need_rclone
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Already running (pid $(cat "$PIDFILE")). Logs: $LOGFILE"
      exit 0
    fi
    mkdir -p "$LOCAL_DIR"
    nohup bash -c "
      while true; do
        \"$0\" once >> '$LOGFILE' 2>&1 || echo \"[\$(date)] sync pass failed\" >> '$LOGFILE'
        sleep $INTERVAL
      done
    " > /dev/null 2>&1 &
    echo $! > "$PIDFILE"
    echo "Syncing every ${INTERVAL}s (pid $(cat "$PIDFILE"))."
    echo "  local folder: $LOCAL_DIR"
    echo "  drive folder: $REMOTE:$REMOTE_DIR"
    echo "  logs:         $LOGFILE"
    ;;

  stop)
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null || true
      rm -f "$PIDFILE"
      echo "Stopped."
    else
      echo "Not running."
    fi
    ;;

  status)
    echo "rclone:       ${RCLONE:-not found}"
    echo "remote:       $REMOTE:$REMOTE_DIR"
    echo "local folder: $LOCAL_DIR"
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "background:   running (pid $(cat "$PIDFILE"))"
    else
      echo "background:   not running"
    fi
    if [ -d "$LOCAL_DIR" ]; then
      echo "files:        $(ls -A "$LOCAL_DIR" 2>/dev/null | wc -l)"
    else
      echo "files:        (folder does not exist yet — run setup)"
    fi
    ;;

  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
