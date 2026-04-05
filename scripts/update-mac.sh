#!/bin/bash
# Contractor — Mac Update Script
# Downloads the latest version and replaces the current binary

set -e

REPO="endlessblink/contractor"
ARCH=$(uname -m)

if [ "$ARCH" = "arm64" ]; then
  SUFFIX="macos-arm64"
else
  SUFFIX="macos-x64"
fi

echo "🔍 Checking for latest version..."
LATEST=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"v\(.*\)".*/\1/')

if [ -z "$LATEST" ]; then
  echo "❌ Could not fetch latest version. Check your internet connection."
  exit 1
fi

echo "📦 Latest version: v$LATEST"
FILENAME="contractor-${SUFFIX}-v${LATEST}"
URL="https://github.com/$REPO/releases/download/v${LATEST}/${FILENAME}"

# Find current binary
CURRENT=$(find ~/Downloads /Applications /tmp -name "contractor-macos*" -type f 2>/dev/null | head -1)

if [ -n "$CURRENT" ]; then
  DIR=$(dirname "$CURRENT")
  echo "📂 Found existing binary at: $CURRENT"
else
  DIR="$HOME/Downloads"
  echo "📂 Downloading to: $DIR"
fi

DEST="$DIR/$FILENAME"

echo "⬇️  Downloading v$LATEST..."
curl -L -o "$DEST" "$URL"

if [ ! -f "$DEST" ]; then
  echo "❌ Download failed"
  exit 1
fi

chmod +x "$DEST"
xattr -d com.apple.quarantine "$DEST" 2>/dev/null || true

echo ""
echo "✅ Downloaded: $DEST"
echo ""
echo "To run: double-click the file, or in Terminal:"
echo "   $DEST"
echo ""

# Kill old version if running
pkill -f "contractor-macos" 2>/dev/null || true
sleep 1

# Start the new version
echo "🚀 Starting Contractor v$LATEST..."
"$DEST" &
