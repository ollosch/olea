#!/usr/bin/env bash
set -euo pipefail

data_dir="$(mktemp -d "${TMPDIR:-/tmp}/olea-e2e.XXXXXX")"
seed_file="$(mktemp "${TMPDIR:-/tmp}/olea-e2e-template.XXXXXX.json")"
trap 'rm -rf "$data_dir"; rm -f "$seed_file"' EXIT

cat >"$seed_file" <<'JSON'
{"templates":[{"source":"E2E","source_id":"e2e-template-table","name":"E2E Template Table","dice":"1d1","entries":[{"min":1,"max":1,"text":"Template result"}]}]}
JSON
go -C server run . --dir="$data_dir" table-template-import dnd5e "$seed_file" >/dev/null
go -C server run . serve --http="127.0.0.1:${E2E_PORT:-8091}" --dir="$data_dir"
