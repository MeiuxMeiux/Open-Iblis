// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

// Capabilities are free-form tags a plugin declares. The shell never asks
// "which plugin?" — it asks "which capability?" and the user's setting picks
// the active implementation (multiple plugins may declare the same one).
//
// These are the capabilities the built-in views look for. Plugins may declare
// others; the `Capability` type stays open to any string.

export const KNOWN_CAPABILITIES = [
  'text-to-music',
  'stem-split',
  'bpm-detect',
  'key-detect',
  'image-gen',
  'cover-art',
  'song-ideas',
  'lyrics-assistance',
  'cover-generation'
] as const

export type KnownCapability = (typeof KNOWN_CAPABILITIES)[number]

// `string & {}` keeps editor autocomplete for the known tags while still
// accepting any arbitrary capability string.
export type Capability = KnownCapability | (string & {})
