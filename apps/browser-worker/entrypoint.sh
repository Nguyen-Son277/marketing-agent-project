#!/usr/bin/env bash
set -euo pipefail
Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp &
for attempt in $(seq 1 50); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then break; fi
  sleep 0.1
done
openbox >/dev/null 2>&1 &
exec ./node_modules/.bin/tsx apps/browser-worker/src/main.ts
