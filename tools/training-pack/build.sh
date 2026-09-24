#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later

# Build the ACE-Step training pack runtime.zip from tools/training-pack/pins.json.
#
#   just training-pack-build        (the only supported entrypoint)
#
# Everything is downloaded into .training-pack-cache/ with sha256
# verification (resumable: verified files are never re-fetched; any
# mismatch aborts the build). The stage tree is assembled fresh each run,
# then zipped deterministically (sorted entries, fixed mtime) to
# packages/plugins/acestep-training/dist/runtime.zip. Expect a multi-GB
# download on first run (torch cu128 + the ACE-Step base checkpoints).
set -euo pipefail

ROOT="$(cd "$(dirname "$(realpath "$0")")/../.." && pwd)"
HERE="$ROOT/tools/training-pack"
PINS="$HERE/pins.json"
CACHE="$ROOT/.training-pack-cache"
STAGE="$CACHE/stage"
PLUGIN="$ROOT/packages/plugins/acestep-training"
OUT="$PLUGIN/dist/runtime.zip"

command -v python3 >/dev/null || { echo "build: python3 is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "build: curl is required" >&2; exit 1; }
command -v git >/dev/null || { echo "build: git is required" >&2; exit 1; }
command -v unzip >/dev/null || { echo "build: unzip is required" >&2; exit 1; }

mkdir -p "$CACHE/downloads"

# --- 1. download + verify every pinned artifact ------------------------------
# assemble.py prints "sha256  url  dest" lines derived from pins.json.
echo "== downloading pinned artifacts into $CACHE/downloads"
python3 "$HERE/assemble.py" manifest "$PINS" | while IFS=$'\t' read -r sha url dest; do
    target="$CACHE/downloads/$dest"
    mkdir -p "$(dirname "$target")"
    if [[ -f "$target" ]]; then
        have="$(sha256sum "$target" | cut -d' ' -f1)"
        if [[ "$have" == "$sha" ]]; then
            echo "   cached  $dest"
            continue
        fi
        echo "   stale   $dest (hash changed, refetching)"
        rm -f "$target"
    fi
    echo "   fetch   $dest"
    curl -fSL --retry 3 -o "$target.part" "$url"
    have="$(sha256sum "$target.part" | cut -d' ' -f1)"
    if [[ "$have" != "$sha" ]]; then
        echo "build: HASH MISMATCH for $dest" >&2
        echo "  expected $sha" >&2
        echo "  got      $have" >&2
        exit 1
    fi
    mv "$target.part" "$target"
done

# --- 2. vendor the pinned ACE-Step revision ----------------------------------
ACE_COMMIT="$(python3 -c "import json;print(json.load(open('$PINS'))['aceStep']['commit'])")"
ACE_REPO="$(python3 -c "import json;print(json.load(open('$PINS'))['aceStep']['repo'])")"
ACE_DIR="$CACHE/ace-step-git"
if [[ ! -d "$ACE_DIR/.git" ]]; then
    git clone --no-checkout "$ACE_REPO" "$ACE_DIR"
fi
git -C "$ACE_DIR" fetch --quiet origin "$ACE_COMMIT" 2>/dev/null || git -C "$ACE_DIR" fetch --quiet origin
git -C "$ACE_DIR" checkout --quiet --force "$ACE_COMMIT"
ACTUAL="$(git -C "$ACE_DIR" rev-parse HEAD)"
if [[ "$ACTUAL" != "$ACE_COMMIT" ]]; then
    echo "build: ACE-Step checkout is $ACTUAL, pinned $ACE_COMMIT" >&2
    exit 1
fi

# --- 3. assemble the stage tree ----------------------------------------------
echo "== assembling stage tree at $STAGE"
rm -rf "$STAGE"
python3 "$HERE/assemble.py" stage "$PINS" "$CACHE" "$STAGE" "$PLUGIN/src" "$ACE_DIR"

# Refresh the committed notices skeleton from the same inventory.
python3 "$HERE/assemble.py" notices "$PINS" "$PLUGIN/THIRD_PARTY_NOTICES.md" "$STAGE"

# --- 4. deterministic zip ------------------------------------------------------
echo "== zipping (deterministic) to $OUT"
mkdir -p "$PLUGIN/dist"
python3 "$HERE/assemble.py" zip "$STAGE" "$OUT"
sha256sum "$OUT"
du -h "$OUT" | cut -f1 | sed 's/^/size /'
echo "== done. Next: just catalog-build (hashes dist/runtime.zip), catalog-publish."
