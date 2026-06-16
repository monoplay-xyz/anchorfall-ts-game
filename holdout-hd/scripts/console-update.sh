#!/usr/bin/env bash
#
# console-update.sh — fast IN-PLACE content update of the web game on a Batocera
# console, WITHOUT rebuilding the AppImage.
#
# It rsyncs the holdout-hd web game source (minus node_modules / dist / .git and
# other build/runtime junk) into the console's unpacked AppImage game directory
# over ssh:
#
#     squashfs-root/resources/game/        (inside the AppImage payload)
#
# Use this when you only changed game content/code (public/, shared/, levels/,
# server.*, etc.) and want it live on the box in seconds instead of doing a full
# electron-builder rebuild + reflash.
#
# SAFE BY DESIGN:
#   * --dry-run shows exactly what WOULD transfer and changes nothing.
#   * every step echoes what it is about to do.
#   * rsync runs WITHOUT --delete by default so a partial/odd source can't wipe
#     the target; pass --delete explicitly to mirror (prune removed files).
#
# Defaults are the documented dev console; override via flags or env vars.
#
# Usage:
#   scripts/console-update.sh [options]
#
# Options:
#   -h, --host HOST       ssh host/ip of the console     (default: $CONSOLE_HOST or 10.0.0.207)
#   -u, --user USER       ssh user                        (default: $CONSOLE_USER or root)
#   -d, --dest PATH       game dir on the console         (default: $CONSOLE_DEST or
#                         /userdata/system/anchorfall/squashfs-root/resources/game)
#   -p, --port PORT       ssh port                        (default: $CONSOLE_PORT or 22)
#   -n, --dry-run         show what would transfer, change nothing
#       --delete          also delete files on the console that no longer exist
#                         in the source (mirror mode — off by default for safety)
#       --help            this help
#
# Examples:
#   scripts/console-update.sh --dry-run
#   scripts/console-update.sh                      # push to 10.0.0.207
#   scripts/console-update.sh -h 10.0.0.50 -u root # a different box
#
set -euo pipefail

# ---- repo root (this script lives in holdout-hd/scripts) -------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---- defaults (env overridable) -------------------------------------------
HOST="${CONSOLE_HOST:-10.0.0.207}"
USER="${CONSOLE_USER:-root}"
DEST="${CONSOLE_DEST:-/userdata/system/anchorfall/squashfs-root/resources/game}"
PORT="${CONSOLE_PORT:-22}"
DRY_RUN=0
DO_DELETE=0

usage() { sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; }

# ---- arg parse -------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--host)   HOST="$2"; shift 2 ;;
    -u|--user)   USER="$2"; shift 2 ;;
    -d|--dest)   DEST="$2"; shift 2 ;;
    -p|--port)   PORT="$2"; shift 2 ;;
    -n|--dry-run) DRY_RUN=1; shift ;;
    --delete)    DO_DELETE=1; shift ;;
    --help)      usage; exit 0 ;;
    *) echo "console-update: unknown option '$1' (try --help)" >&2; exit 2 ;;
  esac
done

# ---- preflight -------------------------------------------------------------
command -v rsync >/dev/null 2>&1 || { echo "console-update: rsync not found on PATH" >&2; exit 1; }

REMOTE="${USER}@${HOST}"
SSH_CMD="ssh -p ${PORT}"

echo "==========================================================="
echo " MONOLYTHIUM — in-place Batocera content update"
echo "-----------------------------------------------------------"
echo " source : ${REPO_ROOT}/"
echo " target : ${REMOTE}:${DEST}/   (port ${PORT})"
echo " mode   : $([ "$DRY_RUN" = 1 ] && echo 'DRY RUN (no changes)' || echo 'LIVE')"
echo " delete : $([ "$DO_DELETE" = 1 ] && echo 'ON  (mirror — prunes removed files)' || echo 'off (additive)')"
echo "==========================================================="

# ---- rsync excludes: never push build artifacts / git / local state -------
EXCLUDES=(
  --exclude '.git/'
  --exclude 'node_modules/'
  --exclude 'dist/'
  --exclude 'desktop/'        # the Electron shell is what wraps this; not game content
  --exclude 'saves/'          # local save slots
  --exclude '*.log'
  --exclude '.DS_Store'
  --exclude '.railwayignore'
  --exclude '.dockerignore'
)

RSYNC_FLAGS=(-az --human-readable)
# rsync 3.1+ has --info for tidy stats/progress; older rsync (e.g. macOS's stock
# 2.6) doesn't — fall back to -v there so the script runs anywhere.
if rsync --version 2>/dev/null | head -1 | grep -Eq 'version 3\.[1-9]|version [4-9]'; then
  RSYNC_FLAGS+=(--info=stats1,progress2)
else
  RSYNC_FLAGS+=(-v)
fi
[ "$DRY_RUN" = 1 ]   && RSYNC_FLAGS+=(--dry-run)
[ "$DO_DELETE" = 1 ] && RSYNC_FLAGS+=(--delete)

# ---- ensure the target dir exists (skipped in dry-run) --------------------
if [ "$DRY_RUN" = 1 ]; then
  echo "[dry-run] would ensure remote dir exists: ${DEST}"
else
  echo "==> ensuring remote game dir exists"
  $SSH_CMD "$REMOTE" "mkdir -p '${DEST}'"
fi

# ---- the transfer ----------------------------------------------------------
echo "==> rsync game source -> console"
# trailing slash on the source copies its CONTENTS into ${DEST}/
rsync "${RSYNC_FLAGS[@]}" "${EXCLUDES[@]}" \
  -e "$SSH_CMD" \
  "${REPO_ROOT}/" "${REMOTE}:${DEST}/"

echo "-----------------------------------------------------------"
if [ "$DRY_RUN" = 1 ]; then
  echo " DRY RUN complete — nothing was changed on the console."
  echo " Re-run without --dry-run to apply."
else
  echo " Update applied. Relaunch the game on the console to load it"
  echo " (close + reopen the port entry, or restart EmulationStation)."
fi
echo "==========================================================="
