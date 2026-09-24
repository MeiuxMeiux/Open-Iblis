// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Product-key input handling shared by the licensing service and its tests.

// Crockford base32 without I, L, O, U: the exact alphabet the server issues.
const NORMALIZED_KEY = /^[0-9A-HJKMNP-TV-Z]{16}$/
// Longest plausible pasted input (display form plus stray whitespace).
const MAX_KEY_INPUT = 64

// Mirror of apps/site/src/Keys/Codec.php normalize(): uppercase, strip the
// IBLIS prefix and separators, map Crockford aliases. Returns the display form
// IBLIS-XXXX-XXXX-XXXX-XXXX, or null when the input cannot be a product key.
// Checked before any network egress so a typo (or an oversized string from a
// compromised renderer) never leaves the machine.
export function normalizeProductKey(input: string): string | null {
  if (input.length > MAX_KEY_INPUT) return null
  let flat = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (flat.startsWith('IBLIS')) flat = flat.slice(5)
  flat = flat.replace(/O/g, '0').replace(/[IL]/g, '1')
  if (!NORMALIZED_KEY.test(flat)) return null
  return `IBLIS-${flat.slice(0, 4)}-${flat.slice(4, 8)}-${flat.slice(8, 12)}-${flat.slice(12)}`
}

export function maskKey(key: string): string {
  const flat = key
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^IBLIS/, '')
  return `IBLIS-****-****-****-${flat.slice(-4)}`
}
