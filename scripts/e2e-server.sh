#!/usr/bin/env bash
set -euo pipefail

data_dir="$(mktemp -d "${TMPDIR:-/tmp}/olea-e2e.XXXXXX")"
trap 'rm -rf "$data_dir"' EXIT

go -C server run . serve --http="127.0.0.1:${E2E_PORT:-8091}" --dir="$data_dir"
