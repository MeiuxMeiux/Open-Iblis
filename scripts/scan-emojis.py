#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later

"""Fail (exit 1) if any input file contains an emoji character.

The no-emoji rule (docs/feature/copy-and-tone.md) is non-negotiable. This
catches the common pictographic ranges; it does NOT catch every plausible
"emoji-like" glyph but covers the realistic mistakes."""

from __future__ import annotations

import sys
import unicodedata

RANGES = [
    (0x1F300, 0x1FAFF),  # most pictographic blocks
    (0x2600,  0x27BF),   # misc symbols, dingbats
    (0x1F1E6, 0x1F1FF),  # regional indicators (flags)
    (0xFE0F,  0xFE0F),   # variation selector-16 used by emoji presentation
]

def is_emoji(ch: str) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in RANGES)

def main(argv: list[str]) -> int:
    fail = 0
    for path in argv[1:]:
        try:
            with open(path, encoding="utf-8") as fh:
                for line_no, line in enumerate(fh, start=1):
                    for col, ch in enumerate(line, start=1):
                        if is_emoji(ch):
                            name = unicodedata.name(ch, f"U+{ord(ch):04X}")
                            print(f"  emoji at {path}:{line_no}:{col}  ({name})")
                            fail = 1
                            break
        except (OSError, UnicodeDecodeError):
            continue
    return fail

if __name__ == "__main__":
    sys.exit(main(sys.argv))
