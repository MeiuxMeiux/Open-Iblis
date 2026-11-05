#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Smoke the packaged, ad-hoc sealed Mac app on a CI runner (mac-build.yml):
#   1. mount the dmg, copy the app out, check its seal, arch and Info.plist
#   2. with an engine pack pre-installed (the Mac ace-server built in the same
#      run, a platform-aware manifest, the GGUFs), start the app and wait for
#      the shell to launch that engine through its normal supervisor: proves
#      the platform fields pick `ace-server` (not `ace-server.exe`) on macOS
#   3. stop it and check the app did not break its own seal
#
#   smoke-app.sh <dmg> <ace-server> <models-dir> <out-dir>
set -euo pipefail
dmg="$1"; engine="$2"; models="$3"; out="$4"
mkdir -p "$out"
app=/tmp/Iblis.app

hdiutil attach "$dmg" -nobrowse -mountpoint /tmp/iblis-dmg >/dev/null
rm -rf "$app"; cp -R /tmp/iblis-dmg/Iblis.app "$app"
hdiutil detach /tmp/iblis-dmg >/dev/null

codesign -dv "$app" 2>&1 | grep -E "Signature|Identifier|Format" | tee "$out/codesign.txt"
codesign --verify --deep --strict "$app" && echo "seal intact (before run)"
lipo -archs "$app/Contents/MacOS/Iblis" | tee "$out/arch.txt"
plutil -p "$app/Contents/Info.plist" | grep -E "LSMinimumSystemVersion|CFBundleShortVersionString|LSApplicationCategoryType" | tee "$out/info-plist.txt"

# A pre-installed engine pack, laid out exactly as the installer writes one.
# Next to the models (same volume), so the GGUFs can be hard-linked: the
# engine's model scan skips symlinks, and copying 3.3 GB is slow.
plugins="$(cd "$models/.." && pwd)/.smoke-plugins"
rm -rf "$plugins"
ver=0.2.0
dir="$plugins/mx.iblis.engine.acestep/$ver"
mkdir -p "$dir"
cp "$engine" "$dir/ace-server"
for f in "$models"/*.gguf; do ln "$f" "$dir/$(basename "$f")" 2>/dev/null || cp "$f" "$dir/"; done
python3 - "$dir/manifest.json" <<'PY'
import json, sys
asset = lambda p, plats: {"path": p, "sha256": "0" * 64, "bytes": 1, "executable": True,
                          "platforms": plats, "sources": [{"kind": "gcs", "url": "https://example.invalid/" + p}]}
json.dump({
    "id": "mx.iblis.engine.acestep", "name": "ACE-Step 1.5", "version": "0.2.0", "kind": "engine",
    "hostMinVersion": "0.0.0-0", "platforms": ["win32-x64", "darwin-arm64"], "capabilities": ["text-to-music"],
    "executable": {"bin": "ace-server.exe", "portArg": "--port",
                   "args": ["--models", ".", "--host", "127.0.0.1", "--keep-loaded"],
                   "healthPath": "/health", "healthTimeoutMs": 300000,
                   "platforms": [{"platforms": ["darwin"], "bin": "ace-server"}]},
    "assets": [asset("ace-server.exe", ["win32-x64"]), asset("ace-server", ["darwin-arm64"])],
    "license": "MIT", "author": {"name": "Meiux Meiux LLC"}}, open(sys.argv[1], "w"), indent=2)
PY
echo "$ver" > "$plugins/mx.iblis.engine.acestep/current.txt"

# userData follows the packaged app name; find main.log after start rather
# than guess the folder.
support="$HOME/Library/Application Support"
find "$support" -name main.log -path '*/logs/*' -delete 2>/dev/null || true
IBLIS_PLUGINS_DIR="$plugins" "$app/Contents/MacOS/Iblis" > "$out/app-stdout.log" 2>&1 &
pid=$!
started=""
for _ in $(seq 1 240); do
  if grep '"sidecar started"' "$out/app-stdout.log" 2>/dev/null | grep -q acestep; then
    started=1; break
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done
mainlog="$(find "$support" -name main.log -path '*/logs/*' 2>/dev/null | head -n1)"
[[ -n "$mainlog" ]] && { echo "logs: $(dirname "$mainlog")" | tee "$out/log-dir.txt"; cp "$(dirname "$mainlog")"/*.log "$out/"; }
kill "$pid" 2>/dev/null || true
for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
pkill -x Iblis 2>/dev/null || true
pkill -x ace-server 2>/dev/null || true
grep -q '"shell started"' "$out/app-stdout.log" || { echo "::error::the app never logged 'shell started'"; cat "$out/app-stdout.log"; exit 1; }
[[ -n "$started" ]] || { echo "::error::the app did not start the Mac engine"; tail -n 40 "$out/app-stdout.log"; exit 1; }
grep -E 'ace-server( |$)' "$out"/sidecar-*.log | head -3 || true
echo "app started the Mac engine (ace-server) through its supervisor"

codesign --verify --deep --strict "$app" && echo "seal intact (after run)"
echo "APP SMOKE OK"
