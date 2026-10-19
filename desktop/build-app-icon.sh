#!/bin/zsh
set -euo pipefail

# macOS Dock/Finder icons must be supplied as an .icns file containing several
# bitmap sizes. Keep the original artwork in the project and regenerate the
# icon on every desktop build so the source image remains easy to replace.
# Keep Swift's input paths canonical; see build-macos-app.sh for why this is
# important when Finder or a terminal has entered the checkout with different
# letter casing.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
SOURCE_IMAGE="$PROJECT_DIR/desktop/assets/PersonalTaskBoard.png"
ICONSET_DIR="$PROJECT_DIR/work/PersonalTaskBoard.iconset"
SQUARE_SOURCE="$PROJECT_DIR/work/personal-task-board-icon-1024.png"
OUTPUT_ICON="$PROJECT_DIR/desktop/AppIcon.icns"
RENDERER="$PROJECT_DIR/work/render-app-icon"
# Do not reuse the long-lived cache in work/. A fresh temporary cache avoids
# Swift module collisions after an SDK update or a path-casing change.
MODULE_CACHE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/personal-task-board-icon-module-cache.XXXXXX")"
trap 'rm -rf "$MODULE_CACHE_DIR"' EXIT

if [[ ! -f "$SOURCE_IMAGE" ]]; then
  echo "Missing app icon source: $SOURCE_IMAGE" >&2
  exit 1
fi

mkdir -p "$ICONSET_DIR" "$PROJECT_DIR/work"

# Render the supplied artwork on a transparent square canvas. Preserve its
# proportions and colors, adding only a small margin for the macOS Dock.
/usr/bin/swiftc \
  -swift-version 5 \
  -module-cache-path "$MODULE_CACHE_DIR" \
  -framework AppKit \
  "$PROJECT_DIR/desktop/render-app-icon.swift" \
  -o "$RENDERER"
"$RENDERER" "$SOURCE_IMAGE" "$SQUARE_SOURCE"

# These filenames document the standard macOS icon sizes. The final packaging
# step below uses the matching PNGs to create a portable .icns container.
for specification in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"; do
  size="${specification%% *}"
  filename="${specification#* }"
  sips --resampleHeightWidth "$size" "$size" "$SQUARE_SOURCE" --out "$ICONSET_DIR/$filename" >/dev/null
done

# Use the small local packer instead of iconutil: the latter can reject valid
# PNG iconsets on some Xcode/command-line-tool installations.
node "$PROJECT_DIR/desktop/create-icns.mjs" "$ICONSET_DIR" "$OUTPUT_ICON"
