#!/usr/bin/env sh
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MAIN_OUT="$ROOT/apps/shell/out/main"

worker=""
count=0
for candidate in "$MAIN_OUT"/waveform-worker-*.js; do
  [ -f "$candidate" ] || continue
  worker="$candidate"
  count=$((count + 1))
done
if [ "$count" -ne 1 ]; then
  echo "expected one built waveform worker under apps/shell/out/main; found $count" >&2
  exit 1
fi

node "$ROOT/apps/shell/scripts/analysis-worker-smoke.mjs" "$worker"
echo "shell-analysis-smoke: ok"
