#!/usr/bin/env sh
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later

# Documentation screenshots: Playwright drives the built shell (apps/shell/out)
# under xvfb on Linux and writes PNGs to the directory given as $1
# (default apps/shell/shots/).

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUT="${1:-$ROOT/apps/shell/shots}"
case "$OUT" in /*) ;; *) OUT="$PWD/$OUT" ;; esac
cd "$ROOT/apps/shell"

[ -f out/main/index.js ] || { echo "no shell bundle; run just build" >&2; exit 1; }
export IBLIS_SHOTS_DIR="$OUT"

case "$(uname -s)" in
  Linux*)
    command -v xvfb-run >/dev/null || { echo "xvfb-run is required" >&2; exit 1; }
    xvfb-run -a pnpm exec vitest run -c vitest.shots.config.mts
    ;;
  *) pnpm exec vitest run -c vitest.shots.config.mts ;;
esac
echo "screenshots written to $OUT"
