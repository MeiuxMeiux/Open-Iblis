// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Built-in skin registry + persistence. Skins are tokens-only (see
// skins.css); this module is the single source of truth for which skins
// exist, how they read in a picker, and how the active choice is stored.
//
// Mirrors the website's assets/js/skin.js (same storage key, same default,
// same parse-time-apply-to-avoid-flash pattern) so the shell and site agree.
// Kept free of DOM/Svelte imports so the resolution + persistence logic is
// unit-testable under the node test environment.

export interface ShellSkin {
  id: string
  name: string
  theme: 'dark' | 'light'
  vibe: string
  // [bg-base, bg-elevated, accent, accent-cool, text-primary] — picker swatch.
  swatches: [string, string, string, string, string]
  // True for skins delivered as catalog plugins (vs the built-ins below).
  installed?: boolean
}

export const SKINS: readonly ShellSkin[] = [
  {
    id: 'dark-3d',
    name: 'Dark 3D',
    theme: 'dark',
    vibe: 'Default. Deep black + anaglyph red/blue.',
    swatches: ['#020203', '#0a0a10', '#e23535', '#3580ff', '#ecedf2']
  },
  {
    id: 'light-paper',
    name: 'Light Paper',
    theme: 'light',
    vibe: 'Restrained light skin. Paper-white surfaces.',
    swatches: ['#f6f5f1', '#ffffff', '#c92626', '#2057c8', '#161615']
  },
  {
    id: 'infernal',
    name: 'Infernal',
    theme: 'dark',
    vibe: 'Running-gag skin. Red lens, very dark.',
    swatches: ['#0a0204', '#150508', '#ff3b3b', '#d24a4a', '#f0d8da']
  },
  {
    id: 'cathedral',
    name: 'Cathedral',
    theme: 'dark',
    vibe: 'Warm gold and candlelight on dark.',
    swatches: ['#0e0a05', '#1a1308', '#d8a13a', '#6e9bc4', '#f4e3c1']
  }
] as const

export const DEFAULT_SKIN = 'dark-3d'
const STORAGE_KEY = 'iblis.skin'

const ALLOWED = new Set(SKINS.map((s) => s.id))

/**
 * True if `v` is a known skin id. `extra` carries installed-skin ids (built-ins
 * are always allowed), so a persisted installed skin survives validation.
 */
export const isSkinId = (v: unknown, extra?: ReadonlySet<string>): v is string =>
  typeof v === 'string' && (ALLOWED.has(v) || (extra?.has(v) ?? false))

/** Coerce any value to a valid skin id, falling back to the default. */
export const resolveSkin = (v: unknown, extra?: ReadonlySet<string>): string =>
  isSkinId(v, extra) ? v : DEFAULT_SKIN

// Minimal shapes so this module doesn't depend on lib.dom; the real
// localStorage / documentElement satisfy them at the call sites.
interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}
interface ElementLike {
  setAttribute(name: string, value: string): void
}

const defaultStorage = (): StorageLike | undefined =>
  (globalThis as { localStorage?: StorageLike }).localStorage

const defaultRoot = (): ElementLike | undefined =>
  (globalThis as { document?: { documentElement: ElementLike } }).document?.documentElement

/** Read the persisted skin id, validated; default on any failure. `extra`
 * carries installed-skin ids so a persisted installed skin isn't reset. */
export function readSkin(storage = defaultStorage(), extra?: ReadonlySet<string>): string {
  try {
    return resolveSkin(storage?.getItem(STORAGE_KEY) ?? null, extra)
  } catch {
    return DEFAULT_SKIN
  }
}

/** Persist the skin id (validated). Swallows storage errors. */
export function writeSkin(
  id: string,
  storage = defaultStorage(),
  extra?: ReadonlySet<string>
): void {
  try {
    storage?.setItem(STORAGE_KEY, resolveSkin(id, extra))
  } catch {
    /* storage unavailable — non-fatal, the default applies next launch */
  }
}

/** Apply a skin to the document by flipping the `data-skin` attribute. */
export function applySkin(
  id: string,
  root: ElementLike | undefined = defaultRoot(),
  extra?: ReadonlySet<string>
): void {
  root?.setAttribute('data-skin', resolveSkin(id, extra))
}
