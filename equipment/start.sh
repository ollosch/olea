#!/usr/bin/env bash
# Start the Olea equipment manager (PocketBase serves API + built frontend).
set -euo pipefail
cd "$(dirname "$0")"

HOST="${1:-0.0.0.0}"
PORT="${2:-8090}"

if [ ! -x "./pocketbase" ]; then
  echo "pocketbase binary not found. Downloading…" >&2
  ./download-pocketbase.sh
fi

exec ./pocketbase serve --http="${HOST}:${PORT}"
