#!/bin/sh
# Builds dist/rvl.zip for the Chrome Web Store: only the files Chrome loads.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir dist
zip -qr dist/rvl.zip manifest.json src options icons -x '*.DS_Store'
echo "dist/rvl.zip ($(du -h dist/rvl.zip | cut -f1))"
