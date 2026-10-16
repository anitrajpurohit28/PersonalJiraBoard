#!/bin/zsh
set -euo pipefail

DESTINATION="${1:?Pass the destination path for the Node executable}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -m)" in
  arm64) NODE_ARCH="arm64" ;;
  x86_64) NODE_ARCH="x64" ;;
  *) echo "Unsupported Mac architecture: $(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$(dirname "$DESTINATION")"

# Tests and custom build systems may provide a known-portable executable.
if [[ -n "${PTB_NODE_RUNTIME:-}" ]]; then
  cp "$PTB_NODE_RUNTIME" "$DESTINATION"
  chmod +x "$DESTINATION"
  exit 0
fi

NODE_VERSION="${PTB_NODE_VERSION:-$(node --version)}"
NODE_VERSION="${NODE_VERSION#v}"
ARCHIVE_NAME="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
DOWNLOAD_ROOT="https://nodejs.org/dist/v${NODE_VERSION}"
CACHE_DIR="$PROJECT_DIR/work/node-runtime/v${NODE_VERSION}-darwin-${NODE_ARCH}"
CACHED_NODE="$CACHE_DIR/node"

if [[ ! -x "$CACHED_NODE" ]]; then
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TEMP_DIR"' EXIT
  curl --fail --location --retry 3 \
    "$DOWNLOAD_ROOT/$ARCHIVE_NAME" -o "$TEMP_DIR/$ARCHIVE_NAME"
  curl --fail --location --retry 3 \
    "$DOWNLOAD_ROOT/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"

  EXPECTED="$(awk -v archive="$ARCHIVE_NAME" '$2 == archive { print $1 }' "$TEMP_DIR/SHASUMS256.txt")"
  ACTUAL="$(shasum -a 256 "$TEMP_DIR/$ARCHIVE_NAME" | awk '{ print $1 }')"
  if [[ -z "$EXPECTED" || "$EXPECTED" != "$ACTUAL" ]]; then
    echo "Node runtime checksum verification failed." >&2
    exit 1
  fi

  tar -xzf "$TEMP_DIR/$ARCHIVE_NAME" -C "$TEMP_DIR"
  mkdir -p "$CACHE_DIR"
  cp "$TEMP_DIR/node-v${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node" "$CACHED_NODE"
  chmod +x "$CACHED_NODE"
fi

cp "$CACHED_NODE" "$DESTINATION"
chmod +x "$DESTINATION"
