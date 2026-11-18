#!/bin/bash
# Double-click to launch MC Tier List on macOS.
cd "$(dirname "$0")" || exit 1

# Downloaded files carry macOS's "quarantine" flag, which is what triggers the
# "dangerous / can't be verified" warnings. Clear it for this whole folder on every launch.
xattr -dr com.apple.quarantine . >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js is required. Install it from https://nodejs.org (LTS), then double-click this file again." buttons {"OK"} default button "OK" with icon caution' >/dev/null 2>&1
  echo "Node.js is not installed. Get it from https://nodejs.org and try again."
  exit 1
fi

# Electron counts as installed only when its pointer file AND its framework are both present.
electron_ok() {
  [ -f node_modules/electron/path.txt ] && \
  [ -e "node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework" ]
}

unset ELECTRON_SKIP_BINARY_DOWNLOAD ELECTRON_OVERRIDE_DIST_PATH
if ! electron_ok; then
  echo "Setting up Electron (needs internet once)..."
  rm -rf node_modules/electron
  npm install --no-audit --no-fund

  if ! electron_ok; then
    # Newer npm versions skip package install scripts until they are approved.
    npm install-scripts approve electron >/dev/null 2>&1 || true
    npm rebuild electron >/dev/null 2>&1 || true
  fi

  if ! electron_ok && [ -d node_modules/electron ]; then
    # The download worked but unpacking was incomplete: unpack the cached zip with macOS's own tool.
    ZIP=$(ls -t "$HOME"/Library/Caches/electron/*/electron-v*-darwin-*.zip 2>/dev/null | head -1)
    if [ -n "$ZIP" ]; then
      echo "Unpacking the downloaded Electron..."
      rm -rf node_modules/electron/dist
      mkdir -p node_modules/electron/dist
      ditto -x -k "$ZIP" node_modules/electron/dist
      printf "Electron.app/Contents/MacOS/Electron" > node_modules/electron/path.txt
    fi
  fi

  if ! electron_ok; then
    echo ""
    echo "Electron could not be set up. Check your internet connection and try again."
    echo "If it keeps happening, copy the messages above and send them to Claude."
    read -r -p "Press Enter to close"
    exit 1
  fi
fi

exec ./node_modules/.bin/electron .
