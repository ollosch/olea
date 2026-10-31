#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  printf 'Usage: %s DATA_DIR\n' "$0" >&2
  printf 'Example: %s /tmp/olea-fresh-data\n' "$0" >&2
  exit 2
fi

data_dir=$1
case "$data_dir" in
  /*) ;;
  *) data_dir="$(pwd)/$data_dir" ;;
esac

if [ ! -d "$data_dir" ]; then
  mkdir -p "$data_dir"
fi

exec go -C server run . serve --http=127.0.0.1:8090 --dir="$data_dir"
