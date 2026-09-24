#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later

# Guard against `<style src="...">` in Svelte components.
#
# vitePreprocess (our only Svelte preprocessor) silently IGNORES the `src`
# attribute on <style>: the referenced stylesheet is never compiled and never
# ships. Two Styles-view components shipped like that for weeks, rendering with
# raw browser defaults. Keep component CSS inline in the <style> block (or, for
# app-wide tokens, in app.css imported by main). This scan fails CI on the
# pattern so it can't regress.
set -euo pipefail

cd "$(dirname "$(realpath "$0")")/.."

hits="$(grep -rREn '<style[^>]*\bsrc=' apps --include='*.svelte' || true)"

if [ -n "$hits" ]; then
    echo "error: <style src> is ignored by vitePreprocess — the CSS never ships." >&2
    echo "Move the rules inline into the component's <style> block:" >&2
    echo "$hits" >&2
    exit 1
fi
