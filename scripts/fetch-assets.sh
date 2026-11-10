#!/bin/sh
# Public reference data bundled into the extension. Run once before building.
set -e
cd "$(dirname "$0")/.."
mkdir -p assets
curl -sSfL -o assets/blaze_face_short_range.tflite https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite
curl -sSfL -o /tmp/shareless-tranco.zip https://tranco-list.eu/top-1m.csv.zip
unzip -p /tmp/shareless-tranco.zip | head -100000 | cut -d, -f2 | tr -d '\r' > assets/top-domains.txt
rm /tmp/shareless-tranco.zip
echo "assets ready"
