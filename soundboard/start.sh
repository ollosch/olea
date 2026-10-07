#!/usr/bin/env bash
# Start the Olea soundboard (Express server: frontend + audio library).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8091}"

if [ ! -d node_modules ]; then
  echo "Installing dependencies…" >&2
  npm install
fi

exec node server.js
