// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Crockford base32, lowercase: ULIDs are case-insensitive, and the id doubles
// as an iblis-track:// hostname, which Chromium lowercases.
const B32 = '0123456789abcdefghjkmnpqrstvwxyz'

function encodeB32(value: number, chars: number): string {
  let out = ''
  for (let i = chars - 1; i >= 0; i--) {
    out = B32.charAt(value % 32) + out
    value = Math.floor(value / 32)
  }
  return out
}

export function makeUlid(now: number, random: Uint8Array): string {
  let rand = ''
  for (let i = 0; i < 16; i++) rand += B32.charAt((random[i] ?? 0) % 32)
  return encodeB32(now, 10) + rand
}

// Display name auto-derived from prompt + seed: first line, truncated, with
// the seed appended so sibling takes of one prompt stay distinguishable.
export function deriveTrackName(prompt: string, seed?: number): string {
  const first = (prompt.trim().split('\n')[0] ?? '').trim()
  const base = first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first
  const suffix = seed !== undefined ? ` — ${seed}` : ''
  return (base || 'Untitled') + suffix
}
