#!/usr/bin/env sh
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SHELL_DIR="$ROOT/apps/shell"
OUT="$SHELL_DIR/.media-test"

rm -rf "$OUT"
trap 'rm -rf "$OUT"' 0

cd "$SHELL_DIR"
pnpm exec tsc -p tsconfig.media-integration.json

if ! node -e "require('electron')" >/dev/null 2>&1; then
  echo "Electron binary is missing; run just shell-install" >&2
  exit 1
fi
# Invoke Electron through its Node CLI instead of a platform-specific .bin
# shim. cli.js resolves and spawns the installed native binary.
electron_cli="$SHELL_DIR/node_modules/electron/cli.js"

case "$(uname -s)" in
  Linux*)
    command -v xvfb-run >/dev/null || {
      echo "xvfb-run is required for the Electron media integration test" >&2
      exit 1
    }
    xvfb-run -a node "$electron_cli" --no-sandbox --disable-gpu --mute-audio \
      "$OUT/tests/media-protocol.integration.js"
    ;;
  *)
    node "$electron_cli" "$OUT/tests/media-protocol.integration.js"
    ;;
esac

echo "shell-media-test: ok"
