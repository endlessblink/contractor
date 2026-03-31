#!/bin/bash
# Doc Maker — Linux/macOS Installer v1.1.4
set -e
echo ""
echo "  📄 Doc Maker — Installer v1.1.4"
echo ""
INSTALL_DIR="$HOME/.local/share/doc-maker"
mkdir -p "$INSTALL_DIR"
SUFFIX="linux-x64"
[[ "$(uname)" == "Darwin" ]] && SUFFIX="macos-arm64"
URL="https://github.com/endlessblink/contractor/releases/download/v1.1.4/contractor-$SUFFIX"
echo "  Downloading..."
curl -fSL "$URL" -o "$INSTALL_DIR/doc-maker" --progress-bar
chmod +x "$INSTALL_DIR/doc-maker"
# Create symlink
mkdir -p "$HOME/.local/bin"
ln -sf "$INSTALL_DIR/doc-maker" "$HOME/.local/bin/doc-maker"
echo ""
echo "  ✅ Installed! Run with: doc-maker"
echo "  Or: $INSTALL_DIR/doc-maker"
echo ""
read -p "  Launch now? [Y/n]: " launch
[[ "$launch" != "n" ]] && "$INSTALL_DIR/doc-maker" &
