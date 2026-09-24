// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Installed skin plugins in the renderer. A `kind:"skin"` plugin installed
// through the signed catalog is resolved by main into an InstalledSkin (its
// active version's descriptor + extras.css). This module makes those behave
// EXACTLY like the built-in skins: it generates a `:root[data-skin="<id>"]{…}`
// CSS block from the token map (+ appends extras.css) and injects it as one
// <style> element. After that, applySkin()/applyOverrides() work unchanged.
//
// A localStorage cache of the descriptors lets main.ts re-inject the CSS at
// parse-time (before the async IPC resolves) so an installed skin paints with
// no default-skin flash — the same trick the built-in skins use.
//
// Pure values + a single thin DOM injector — the CSS/derivation/cache logic is
// DOM-free and unit-tested like skins.ts / editor.ts.

import { isSkinToken, tokenToCssVar, type SkinToken } from '@iblis/plugin-sdk'
import type { IblisApi, InstalledSkin } from '../../../shared/contract'
import type { ShellSkin } from './skins'

const CACHE_KEY = 'iblis.skin.installed'
const STYLE_EL_ID = 'iblis-installed-skins'

// --- CSS generation ---------------------------------------------------------

// A data-skin id only ever contains reverse-DNS chars; refuse anything else so
// a tampered cache can't smuggle a selector breakout.
const isSafeSkinId = (id: string): boolean => /^[a-z0-9][a-z0-9.-]*$/.test(id)

// A token value is a single CSS literal (color, length, shadow, font stack).
// Reject the few chars that would let a value break out of its declaration and
// inject arbitrary rules (defence for cached/sideloaded, not-fully-trusted maps).
const isSafeCssValue = (v: string): boolean => !/[{}<>;@\\]/.test(v)

/** The `:root[data-skin="<id>"]{…}` block for one installed skin, + extras.css. */
export function installedSkinCss(skin: InstalledSkin): string {
  if (!isSafeSkinId(skin.id)) return ''
  const lines: string[] = []
  for (const [token, value] of Object.entries(skin.tokens)) {
    if (isSkinToken(token) && typeof value === 'string' && isSafeCssValue(value)) {
      lines.push(`  ${tokenToCssVar(token)}: ${value};`)
    }
  }
  if (lines.length === 0) return '' // no usable tokens → not a skin block
  if (skin.theme) lines.push(`  color-scheme: ${skin.theme};`)
  let css = `:root[data-skin="${skin.id}"] {\n${lines.join('\n')}\n}`
  if (skin.css?.trim()) css += `\n${skin.css.trim()}\n`
  return css
}

/** Concatenated CSS for every installed skin (blank entries dropped). */
export function allInstalledSkinsCss(skins: InstalledSkin[]): string {
  return skins
    .map(installedSkinCss)
    .filter((s) => s !== '')
    .join('\n\n')
}

// --- Picker rows ------------------------------------------------------------

const swatch = (skin: InstalledSkin, token: SkinToken, fallback: string): string => {
  const v = skin.tokens[token]
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback
}

/** Derive a picker entry from an installed skin (marked `installed`). */
export function installedToShellSkin(skin: InstalledSkin): ShellSkin {
  return {
    id: skin.id,
    name: skin.name,
    theme: skin.theme ?? 'dark',
    vibe: `Installed skin · v${skin.version}`,
    swatches: [
      swatch(skin, 'color.bg.base', '#101014'),
      swatch(skin, 'color.bg.elevated', '#1a1a22'),
      swatch(skin, 'color.accent', '#888'),
      swatch(skin, 'color.state.info', swatch(skin, 'color.accent', '#888')),
      swatch(skin, 'color.text.primary', '#eee')
    ],
    installed: true
  }
}

/** The set of installed skin ids (for id validation alongside built-ins). */
export const installedSkinIds = (skins: InstalledSkin[]): Set<string> =>
  new Set(skins.map((s) => s.id))

// --- localStorage cache (render-optimisation; authority is the on-disk asset) -

interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

const defaultStorage = (): StorageLike | undefined =>
  (globalThis as { localStorage?: StorageLike }).localStorage

const str = (v: unknown): v is string => typeof v === 'string'

/** Validate the minimal shape of a cached InstalledSkin (defensive). */
function coerceSkin(raw: unknown): InstalledSkin | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!str(o.id) || !str(o.name) || !str(o.version)) return null
  if (!o.tokens || typeof o.tokens !== 'object') return null
  const tokens: Record<string, string> = {}
  for (const [k, v] of Object.entries(o.tokens as Record<string, unknown>)) {
    if (str(v)) tokens[k] = v
  }
  const skin: InstalledSkin = { id: o.id, name: o.name, version: o.version, tokens }
  if (o.theme === 'dark' || o.theme === 'light') skin.theme = o.theme
  if (str(o.extends)) skin.extends = o.extends
  if (str(o.css)) skin.css = o.css
  return skin
}

/** Read the cached installed-skin descriptors; empty on any failure. */
export function readCachedInstalledSkins(storage = defaultStorage()): InstalledSkin[] {
  try {
    const raw = storage?.getItem(CACHE_KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map(coerceSkin).filter((s): s is InstalledSkin => s !== null)
  } catch {
    return []
  }
}

/** Persist the installed-skin descriptors for flash-free parse-time apply. */
export function writeCachedInstalledSkins(
  skins: InstalledSkin[],
  storage = defaultStorage()
): void {
  try {
    storage?.setItem(CACHE_KEY, JSON.stringify(skins))
  } catch {
    /* storage unavailable — non-fatal, just costs a one-frame flash next launch */
  }
}

// --- DOM injection (the one I/O edge) ---------------------------------------

interface StyleElLike {
  id: string
  textContent: string | null
}
interface DocLike {
  getElementById(id: string): StyleElLike | null
  createElement(tag: 'style'): StyleElLike
  head: { appendChild(el: StyleElLike): void }
}

const defaultDoc = (): DocLike | undefined => (globalThis as { document?: DocLike }).document

/**
 * Inject (or update) the single <style id="iblis-installed-skins"> element that
 * holds every installed skin's CSS. Idempotent — safe to call on every refresh.
 */
export function injectInstalledSkinsCss(css: string, doc = defaultDoc()): void {
  if (!doc) return
  let el = doc.getElementById(STYLE_EL_ID)
  if (!el) {
    el = doc.createElement('style')
    el.id = STYLE_EL_ID
    doc.head.appendChild(el)
  }
  el.textContent = css
}

/**
 * Fetch installed skins from main, refresh the cache + injected CSS, and return
 * them. Falls back to the cache if the IPC is unavailable or errors. Renderer-
 * only (uses window.iblis + document) — the I/O counterpart to the pure helpers
 * above, so it is not unit-tested.
 */
export async function syncInstalledSkins(): Promise<InstalledSkin[]> {
  // window === globalThis in the renderer; reach the bridge through globalThis
  // so this module also type-checks under the DOM-free node tsconfig.
  const bridge = (globalThis as { iblis?: IblisApi }).iblis
  try {
    const res = await bridge?.skins.list()
    if (res?.ok) {
      writeCachedInstalledSkins(res.data)
      injectInstalledSkinsCss(allInstalledSkinsCss(res.data))
      return res.data
    }
  } catch {
    /* fall through to the cache */
  }
  const cached = readCachedInstalledSkins()
  injectInstalledSkinsCss(allInstalledSkinsCss(cached))
  return cached
}
