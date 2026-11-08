#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
version=${1:-dev}
output_dir=${2:-"$repo_root/dist/release"}

case "$version" in
  *[!A-Za-z0-9._+-]*|'')
    printf 'Version must contain only letters, numbers, dots, underscores, plus signs, or hyphens.\n' >&2
    exit 2
    ;;
esac

case "$output_dir" in
  /*) ;;
  *) output_dir="$repo_root/$output_dir" ;;
esac

command -v npm >/dev/null 2>&1 || { printf 'npm is required to build the embedded frontend.\n' >&2; exit 1; }
command -v go >/dev/null 2>&1 || { printf 'Go is required to build Olea.\n' >&2; exit 1; }
command -v zip >/dev/null 2>&1 || { printf 'zip is required to package release archives.\n' >&2; exit 1; }

mkdir -p "$output_dir"
npm --prefix "$repo_root" ci
npm --prefix "$repo_root" run build

staging_dir=$(mktemp -d)
trap 'rm -rf "$staging_dir"' EXIT HUP INT TERM

for target in linux/amd64 linux/arm64 windows/amd64 windows/arm64 darwin/amd64 darwin/arm64; do
  os=${target%/*}
  arch=${target#*/}
  executable=olea
  if [ "$os" = windows ]; then
    executable=olea.exe
  fi

  target_dir="$staging_dir/${os}_${arch}"
  mkdir -p "$target_dir"
  printf 'Building %s/%s...\n' "$os" "$arch"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go -C "$repo_root/server" build \
    -trimpath -ldflags='-s -w' -o "$target_dir/$executable" .

  cat > "$target_dir/README.txt" <<'EOF'
Olea local-network TTRPG companion

Start Olea

Linux/macOS: open a terminal in this folder and run ./olea
Windows: open PowerShell in this folder and run .\olea.exe

Olea starts on port 8090 and prints the local-network addresses to open on
this computer and on other devices connected to the same Wi-Fi/network. Keep
the terminal window open while Olea is in use. If prompted, allow Olea through
the host firewall on your private network only.

Campaign data is stored in the operating system's user configuration folder
under Olea by default. Keep that folder when upgrading Olea. To choose another
writable location, start the program with:

  olea serve --http=0.0.0.0:8090 --dir="PATH_TO_DATA"

On Windows, use olea.exe and a Windows path for PATH_TO_DATA. Back up the
entire data folder only while Olea is stopped. Olea works without internet
access after it has been downloaded; browsers connect over the local network.
EOF

  archive="$staging_dir/olea-${version}-${os}-${arch}.zip"
  (cd "$target_dir" && zip -q -j "$archive" "$executable" README.txt)
done

for archive in "$staging_dir"/olea-"$version"-*.zip; do
  mv "$archive" "$output_dir/"
done

printf 'Release archives are in %s\n' "$output_dir"
