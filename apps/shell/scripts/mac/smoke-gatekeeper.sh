#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later
#
# What a Mac user meets with the unsigned (ad-hoc sealed) app, on a CI
# runner's logged-in session (pattern from the Samsara mac track):
#   1. mark the copy as downloaded (com.apple.quarantine, as Safari and Chrome
#      do) and open it through Launch Services like a double-click: Gatekeeper
#      is expected to refuse it (recorded, not fatal: a runner may not show it)
#   2. `xattr -dr com.apple.quarantine` (the documented workaround) and open
#      again: it must start
#   smoke-gatekeeper.sh /path/to/Iblis.app
set -uo pipefail
app="$1"
support="$HOME/Library/Application Support"
started() { find "$support" -name main.log -path '*/logs/*' -exec grep -l '"shell started"' {} + 2>/dev/null | grep -q .; }
spctl --assess --type execute -vv "$app" 2>&1 | sed 's/^/spctl: /' || true
attempt() {  # $1 label -> 0 when the app logged 'shell started' within 60 s.
  # `open` can block on a Gatekeeper dialog, so it runs in the background and
  # is killed with everything else when time is up.
  find "$support" -name main.log -path '*/logs/*' -delete 2>/dev/null
  open -n -a "$app" >/dev/null 2>&1 &
  local opid=$!
  for _ in $(seq 1 120); do
    if started; then
      echo "$1: started"; kill "$opid" 2>/dev/null; pkill -x Iblis; sleep 3; return 0
    fi
    sleep 0.5
  done
  echo "$1: did not start within 60 s"
  kill "$opid" 2>/dev/null; pkill -x Iblis; pkill -x CoreServicesUIAgent 2>/dev/null; sleep 2; return 1
}
codesign --verify --deep --strict "$app" && echo "seal intact before the test" || { echo "seal broken before the test"; exit 1; }
xattr -w com.apple.quarantine "0081;$(printf %x "$(date +%s)");Safari;$(uuidgen)" "$app"
xattr -p com.apple.quarantine "$app"
if attempt "quarantined (as downloaded)"; then
  echo "NOTE: Gatekeeper let the quarantined copy start here (the runner may have assessments off)"
else
  echo "as expected: Gatekeeper blocks a downloaded unsigned copy"
fi
xattr -dr com.apple.quarantine "$app"
if xattr -lr "$app" | grep -q com.apple.quarantine; then echo "quarantine still set"; exit 1; fi
attempt "after xattr -dr com.apple.quarantine" || exit 1
codesign --verify --deep --strict "$app" && echo "seal intact after the test"
echo "GATEKEEPER SMOKE OK"
