#!/usr/bin/env bash
# Convert royalty-free WAV music-box / alien-relic tracks -> compressed,
# loudness-normalized mp3 for the game. Name each WAV like the level (see
# public/assets/audio/music/TRACKS.md), e.g. story-ch01.wav, stronghold-sh13.wav,
# and optionally musicbox-default.wav (shared fallback).
#
# Usage:  scripts/convert-music.sh <folder-with-wavs>
# Output: public/assets/audio/music/<stem>.mp3  (stereo, 44.1k, 160kbps, -16 LUFS)
set -euo pipefail
SRC="${1:?usage: convert-music.sh <folder-with-wavs>}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/assets/audio/music"
mkdir -p "$OUT"
shopt -s nullglob nocaseglob
n=0
for f in "$SRC"/*.wav; do
  stem="$(basename "${f%.*}")"
  printf '→ %s\n' "$stem"
  ffmpeg -y -i "$f" -vn -ac 2 -ar 44100 -b:a 160k \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
    "$OUT/$stem.mp3" </dev/null >/dev/null 2>&1
  n=$((n+1))
done
echo "converted $n track(s) -> $OUT"
ls -lh "$OUT"/*.mp3 2>/dev/null || echo "(no mp3s yet)"
