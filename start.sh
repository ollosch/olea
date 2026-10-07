#!/usr/bin/env bash
# Start all Olea apps: equipment manager (8090) + soundboard (8091).
set -euo pipefail
cd "$(dirname "$0")"

echo "Starting Olea…"
./equipment/start.sh &
EQUIP_PID=$!
./soundboard/start.sh &
SOUND_PID=$!

cleanup() {
  echo "Stopping Olea…"
  kill "$EQUIP_PID" "$SOUND_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

wait
