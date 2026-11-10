#!/usr/bin/env bash
set -euo pipefail

root="$(dirname "$(dirname "$(realpath "${BASH_SOURCE[0]}")")")"
cd "$root"

if (( $# > 1 )); then
  printf 'Usage: bun run dev:all [DATA_DIR]\n' >&2
  exit 2
fi

data_dir="${1:-$root/pb_data}"
if [[ "$data_dir" != /* ]]; then data_dir="$root/$data_dir"; fi
api_port="${OLEA_API_PORT:-8090}"
frontend_port="${OLEA_FRONTEND_PORT:-5173}"

# The Go executable embeds the built frontend, even when Vite serves the UI.
if [[ ! -f server/ui/dist/index.html ]]; then
  bun run build
fi

# Give each service a process group so its children are stopped as well.
set -m
backend_pid=''
frontend_pid=''
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$backend_pid" ]] || kill -- "-$backend_pid" 2>/dev/null || true
  [[ -z "$frontend_pid" ]] || kill -- "-$frontend_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Starting PocketBase on http://127.0.0.1:%s (data: %s)\n' "$api_port" "$data_dir"
go -C server run . serve --http="127.0.0.1:$api_port" --dir="$data_dir" &
backend_pid=$!

printf 'Starting Vite on http://127.0.0.1:%s\n' "$frontend_port"
E2E_API_PORT="$api_port" bun run dev -- --host 127.0.0.1 --port "$frontend_port" --strictPort &
frontend_pid=$!

wait -n "$backend_pid" "$frontend_pid"
