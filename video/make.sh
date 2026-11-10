#!/bin/sh
# Full pipeline: capture real footage from dist/, render frames, synthesize audio, mux.
#   sh video/make.sh [fps]
set -e
cd "$(dirname "$0")"
FPS=${1:-30}
[ -f footage/meta.json ] || node capture.mjs
node render.mjs video "$FPS" 5
node audio.mjs
ffmpeg -y -loglevel error -i out/frames-video.mp4 -i out/audio.wav -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest out/ShareLess.mp4
echo "out/ShareLess.mp4"
