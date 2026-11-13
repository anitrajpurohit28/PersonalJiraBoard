#!/bin/zsh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
APP_DIR="$PROJECT_DIR/outputs/Personal Jira Board.app"
CONTENTS_DIR="$APP_DIR/Contents"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
PAYLOAD_DIR="$RESOURCES_DIR/app"
MODULE_CACHE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/personal-jira-board-swift.XXXXXX")"
trap 'rm -rf "$MODULE_CACHE_DIR"' EXIT
cd "$PROJECT_DIR"

if [[ ! -d node_modules ]]; then
  echo "Run npm install before building the app." >&2
  exit 1
fi

APP_VERSION="$(node scripts/stamp-version.mjs)"

# Only replace this generated bundle. Personal data lives in Application Support.
rm -rf "$APP_DIR"
mkdir -p "$CONTENTS_DIR/MacOS" "$PAYLOAD_DIR" "$RESOURCES_DIR/runtime"
zsh desktop/build-app-icon.sh
cp desktop/Info.plist "$CONTENTS_DIR/Info.plist"
cp desktop/AppIcon.icns "$RESOURCES_DIR/AppIcon.icns"
cp work/personal-task-board-icon-1024.png "$RESOURCES_DIR/AppIcon.png"
date -u +%Y%m%dT%H%M%SZ > "$RESOURCES_DIR/BuildID.txt"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_VERSION" "$CONTENTS_DIR/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_VERSION" "$CONTENTS_DIR/Info.plist"

# The native shell reads the same runtime settings as the web app.
node --input-type=module > "$RESOURCES_DIR/Runtime.json" <<'NODE'
import { localSettings, configurationId, storageNamespace, appProtocolVersion, helperProtocolVersion } from './config/settings.mjs';
console.log(JSON.stringify({ ...localSettings, configurationId, storageNamespace, appProtocolVersion, helperProtocolVersion }));
NODE

# Copy runtime inputs only. Credentials, databases, caches and tests stay out.
for directory in app config db lib local public scripts worker; do
  mkdir -p "$PAYLOAD_DIR/$directory"
  rsync -a --exclude='.DS_Store' --exclude='credentials.json' "$directory/" "$PAYLOAD_DIR/$directory/"
done
mkdir -p "$PAYLOAD_DIR/desktop"
cp desktop/update-agent.mjs desktop/update-install.mjs "$PAYLOAD_DIR/desktop/"
for file in package.json package-lock.json tsconfig.json vite.config.ts; do
  cp "$file" "$PAYLOAD_DIR/$file"
done
rsync -a --exclude='.DS_Store' --exclude='.cache' --exclude='.vite' node_modules/ "$PAYLOAD_DIR/node_modules/"
(
  cd "$PAYLOAD_DIR"
  npm prune --omit=dev --ignore-scripts --no-audit --no-fund
)
zsh desktop/download-node-runtime.sh "$RESOURCES_DIR/runtime/node"

/usr/bin/swiftc -swift-version 5 -target "$(uname -m)-apple-macosx13.0" -module-cache-path "$MODULE_CACHE_DIR" \
  -framework AppKit -framework WebKit desktop/PersonalJiraBoard.swift \
  -o "$CONTENTS_DIR/MacOS/PersonalJiraBoard"
chmod +x "$CONTENTS_DIR/MacOS/PersonalJiraBoard" "$RESOURCES_DIR/runtime/node"
codesign --force --deep --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"
echo "$APP_DIR"
