// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { InstalledSkin } from '../shared/contract'
import {
  allInstalledSkinsCss,
  injectInstalledSkinsCss,
  installedSkinCss,
  installedSkinIds,
  installedToShellSkin,
  readCachedInstalledSkins,
  writeCachedInstalledSkins
} from '../src/lib/skins/installed'

const skin = (over: Partial<InstalledSkin> = {}): InstalledSkin => ({
  id: 'mx.iblis.skin.boodark-nord',
  name: 'Boodark — Nord',
  version: '1.0.0',
  theme: 'dark',
  extends: 'dark-3d',
  tokens: { 'color.bg.base': '#1f242c', 'color.accent': '#88c0d0' },
  ...over
})

function fakeStorage(seed: Record<string, string> = {}): {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
} {
  const map = new Map(Object.entries(seed))
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

describe('installedSkinCss', () => {
  it('emits a data-skin block of contract tokens + color-scheme', () => {
    const css = installedSkinCss(skin())
    expect(css).toContain(':root[data-skin="mx.iblis.skin.boodark-nord"]')
    expect(css).toContain('--color-bg-base: #1f242c;')
    expect(css).toContain('--color-accent: #88c0d0;')
    expect(css).toContain('color-scheme: dark;')
  })

  it('appends extras.css after the token block', () => {
    const css = installedSkinCss(skin({ css: 'body { background: #000; }' }))
    expect(css.indexOf('body { background')).toBeGreaterThan(css.indexOf('--color-bg-base'))
  })

  it('drops unknown tokens and values that could break out of the rule', () => {
    const css = installedSkinCss(
      skin({
        tokens: {
          'color.accent': '#fff',
          'bogus.token': '#000',
          'color.bg.base': 'red; } body { display: none' // injection attempt
        }
      })
    )
    expect(css).toContain('--color-accent: #fff;')
    expect(css).not.toContain('bogus')
    expect(css).not.toContain('display: none')
  })

  it('returns empty for an unsafe id or a tokenless skin', () => {
    expect(installedSkinCss(skin({ id: 'evil"] body {' }))).toBe('')
    expect(installedSkinCss(skin({ tokens: {} }))).toBe('')
  })
})

describe('allInstalledSkinsCss', () => {
  it('concatenates blocks and drops empty ones', () => {
    const css = allInstalledSkinsCss([skin(), skin({ id: 'bad"]', tokens: {} })])
    expect(css).toContain('mx.iblis.skin.boodark-nord')
    expect(css.match(/:root\[data-skin/g)).toHaveLength(1)
  })
})

describe('installedToShellSkin', () => {
  it('derives a picker row with swatches and an installed flag', () => {
    const row = installedToShellSkin(skin())
    expect(row.installed).toBe(true)
    expect(row.swatches[0]).toBe('#1f242c')
    expect(row.swatches[2]).toBe('#88c0d0')
    expect(row.vibe).toContain('v1.0.0')
  })

  it('falls back for missing/invalid swatch tokens', () => {
    const row = installedToShellSkin(skin({ tokens: { 'color.accent': 'notacolor' } }))
    expect(row.swatches.every((s) => typeof s === 'string')).toBe(true)
  })
})

describe('cache', () => {
  it('round-trips and validates the shape on read', () => {
    const s = fakeStorage()
    writeCachedInstalledSkins([skin()], s)
    expect(readCachedInstalledSkins(s)).toEqual([skin()])
  })

  it('drops malformed entries and survives bad JSON', () => {
    expect(readCachedInstalledSkins(fakeStorage({ 'iblis.skin.installed': '{bad' }))).toEqual([])
    const s = fakeStorage({
      'iblis.skin.installed': JSON.stringify([
        { id: 'ok.skin', name: 'X', version: '1.0.0', tokens: { 'color.accent': '#fff' } },
        { id: 'no-tokens', name: 'Y', version: '1.0.0' },
        'garbage'
      ])
    })
    const out = readCachedInstalledSkins(s)
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('ok.skin')
  })

  it('installedSkinIds collects ids', () => {
    expect(installedSkinIds([skin(), skin({ id: 'a.b' })])).toEqual(
      new Set(['mx.iblis.skin.boodark-nord', 'a.b'])
    )
  })
})

describe('injectInstalledSkinsCss', () => {
  it('creates the style element once and updates its text', () => {
    const els = new Map<string, { id: string; textContent: string | null }>()
    const appended: unknown[] = []
    const doc = {
      getElementById: (id: string) => els.get(id) ?? null,
      createElement: () => ({ id: '', textContent: '' as string | null }),
      head: {
        appendChild: (el: { id: string; textContent: string | null }) => {
          els.set(el.id, el)
          appended.push(el)
        }
      }
    }
    injectInstalledSkinsCss('/* one */', doc)
    injectInstalledSkinsCss('/* two */', doc)
    expect(appended).toHaveLength(1) // reused, not re-created
    expect(els.get('iblis-installed-skins')?.textContent).toBe('/* two */')
  })
})
