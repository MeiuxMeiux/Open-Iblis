// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// In-app skin editor — the logic behind Settings → Appearance → "Edit current
// skin" (see docs/feature/skins.md "In-app editor"). Lets you live-edit any
// SkinContract token on top of the active built-in skin; edits are stored as
// per-skin OVERRIDES (so each skin keeps its own tweaks) and re-applied at
// parse-time next launch. Pure values + persistence only — no Svelte/DOM
// imports, so it unit-tests under the node environment like skins.ts.

import { SKIN_TOKENS, isSkinToken, tokenToCssVar, type SkinToken } from '@iblis/plugin-sdk'

// --- The grid: contract tokens grouped by namespace, in contract order. ------

export type TokenKind = 'color' | 'text'

// color.* and wave.* are single colors → a colour picker fits. Everything else
// (radii, shadows, spacing, type, motion) is free-form CSS → a text field.
export const tokenKind = (t: SkinToken): TokenKind =>
  t.startsWith('color.') || t.startsWith('wave.') ? 'color' : 'text'

export interface TokenGroup {
  ns: string // first dotted segment, e.g. "color"
  label: string // human label for the section header
  tokens: SkinToken[]
}

const LABELS: Record<string, string> = {
  color: 'Color',
  radius: 'Radius',
  shadow: 'Shadow',
  space: 'Spacing',
  font: 'Typography',
  motion: 'Motion',
  wave: 'Waveform'
}

/** Contract tokens grouped by namespace, preserving SKIN_TOKENS order. */
export const TOKEN_GROUPS: readonly TokenGroup[] = (() => {
  const groups: TokenGroup[] = []
  const byNs = new Map<string, TokenGroup>()
  for (const token of SKIN_TOKENS) {
    const ns = token.split('.')[0] ?? token
    let group = byNs.get(ns)
    if (!group) {
      group = { ns, label: LABELS[ns] ?? ns, tokens: [] }
      byNs.set(ns, group)
      groups.push(group)
    }
    group.tokens.push(token)
  }
  return groups
})()

/** Filter groups (and their tokens) by a free-text query over the token name. */
export function filterGroups(query: string): TokenGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return TOKEN_GROUPS.map((g) => ({ ...g, tokens: [...g.tokens] }))
  return TOKEN_GROUPS.map((g) => ({
    ...g,
    tokens: g.tokens.filter((t) => t.toLowerCase().includes(q))
  })).filter((g) => g.tokens.length > 0)
}

// --- Override persistence: { [skinId]: { [token]: cssValue } }. -------------

const OVERRIDES_KEY = 'iblis.skin.overrides'
const MAX_VALUE_LEN = 200 // a sane cap; token values are short CSS literals

/** skinId → (token → CSS value). Only contract tokens are ever stored. */
export type SkinOverrides = Record<string, string>
export type AllOverrides = Record<string, SkinOverrides>

interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}
interface StyleLike {
  setProperty(p: string, v: string): void
  removeProperty(p: string): void
}
interface RootLike {
  style: StyleLike
}

const defaultStorage = (): StorageLike | undefined =>
  (globalThis as { localStorage?: StorageLike }).localStorage

const defaultRoot = (): RootLike | undefined =>
  (globalThis as { document?: { documentElement: RootLike } }).document?.documentElement

/** Keep only contract tokens mapped to short string values. */
export function sanitizeOverrides(raw: unknown): SkinOverrides {
  const clean: SkinOverrides = {}
  if (!raw || typeof raw !== 'object') return clean
  for (const [token, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isSkinToken(token) && typeof value === 'string' && value.length <= MAX_VALUE_LEN) {
      clean[token] = value
    }
  }
  return clean
}

/** Drop unknown tokens, non-string values, and over-long values. */
function sanitize(raw: unknown): AllOverrides {
  const out: AllOverrides = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [skinId, tokens] of Object.entries(raw as Record<string, unknown>)) {
    const clean = sanitizeOverrides(tokens)
    if (Object.keys(clean).length > 0) out[skinId] = clean
  }
  return out
}

/** Read all persisted overrides, validated; empty on any failure. */
export function readOverrides(storage = defaultStorage()): AllOverrides {
  try {
    const raw = storage?.getItem(OVERRIDES_KEY)
    return raw ? sanitize(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

/** Persist all overrides (sanitised). Swallows storage errors. */
/** A copy of `record` without `key` (key order otherwise preserved). */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

function writeOverrides(all: AllOverrides, storage = defaultStorage()): void {
  try {
    storage?.setItem(OVERRIDES_KEY, JSON.stringify(sanitize(all)))
  } catch {
    /* storage unavailable — non-fatal, edits just don't persist */
  }
}

/** Overrides for a single skin (empty object if none). */
export function getOverrides(skinId: string, storage = defaultStorage()): SkinOverrides {
  return readOverrides(storage)[skinId] ?? {}
}

/** Set one token override for a skin and persist. Returns the skin's new map. */
export function setOverride(
  skinId: string,
  token: SkinToken,
  value: string,
  storage = defaultStorage()
): SkinOverrides {
  const all = readOverrides(storage)
  const skin = { ...(all[skinId] ?? {}), [token]: value }
  all[skinId] = skin
  writeOverrides(all, storage)
  return skin
}

/** Remove one token override for a skin and persist. Returns the new map. */
export function clearOverride(
  skinId: string,
  token: SkinToken,
  storage = defaultStorage()
): SkinOverrides {
  const all = readOverrides(storage)
  const skin = omitKey(all[skinId] ?? {}, token)
  if (Object.keys(skin).length > 0) writeOverrides({ ...all, [skinId]: skin }, storage)
  else writeOverrides(omitKey(all, skinId), storage)
  return skin
}

/**
 * Replace a skin's entire override map (sanitised) and persist. Used by skin
 * import, where the incoming descriptor's tokens become the skin's overrides.
 * An empty map drops the skin entry entirely. Returns the new map.
 */
export function setAllOverrides(
  skinId: string,
  overrides: SkinOverrides,
  storage = defaultStorage()
): SkinOverrides {
  const all = readOverrides(storage)
  const clean = sanitizeOverrides(overrides)
  if (Object.keys(clean).length > 0) writeOverrides({ ...all, [skinId]: clean }, storage)
  else writeOverrides(omitKey(all, skinId), storage)
  return clean
}

/** Remove every override for a skin and persist. */
export function clearSkinOverrides(skinId: string, storage = defaultStorage()): void {
  writeOverrides(omitKey(readOverrides(storage), skinId), storage)
}

/**
 * Apply a skin's overrides to the document as inline custom properties, and
 * clear any contract property that is NOT overridden (so removing an edit
 * reverts to the skin's own value). Safe to call on every skin switch.
 */
export function applyOverrides(
  skinId: string,
  root = defaultRoot(),
  storage = defaultStorage()
): void {
  if (!root) return
  const skin = getOverrides(skinId, storage)
  for (const token of SKIN_TOKENS) {
    const cssVar = tokenToCssVar(token)
    const value = skin[token]
    if (value != null) root.style.setProperty(cssVar, value)
    else root.style.removeProperty(cssVar)
  }
}
