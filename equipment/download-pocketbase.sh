#!/usr/bin/env bash
# Download the PocketBase binary for this platform into this folder.
# Used when the `pocketbase` executable is not present (see start.sh).
set -euo pipefail
cd "$(dirname "$0")"

VERSION="0.40.4"

case "$(uname -s)" in
  Linux) OS="linux" ;;
  Darwin) OS="darwin" ;;
  *) echo "Unsupported OS" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture" >&2; exit 1 ;;
esac

URL="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/pocketbase_${VERSION}_${OS}_${ARCH}.zip"

echo "Downloading ${URL}"
curl -sL -o /tmp/pocketbase.zip "$URL"
unzip -o /tmp/pocketbase.zip -d . pocketbase
chmod +x ./pocketbase
rm -f /tmp/pocketbase.zip

echo "Done. Run ./start.sh to launch."
