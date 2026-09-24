#!/usr/bin/env sh
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later

# Renderer E2E: Playwright drives the built shell (apps/shell/out) in a real
# Electron against a loopback fixture server (apps/shell/e2e/).

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT/apps/shell"

if ! node -e "require('electron')" >/dev/null 2>&1; then
  echo "Electron binary is missing; run just shell-install" >&2
  exit 1
fi
[ -f out/main/index.js ] || { echo "no shell bundle; run just build" >&2; exit 1; }

case "$(uname -s)" in
  Linux*)
    command -v xvfb-run >/dev/null || {
      echo "xvfb-run is required for the shell E2E suite" >&2
      exit 1
    }
    xvfb-run -a pnpm e2e
    ;;
  *)
    pnpm e2e
    ;;
esac
