// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SKIN_TOKENS, tokenToCssVar } from '@iblis/plugin-sdk'
import {
  DEFAULT_SKIN,
  SKINS,
  applySkin,
  isSkinId,
  readSkin,
  resolveSkin,
  writeSkin
} from '../src/lib/skins/skins'

const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8')
const appCss = read('src/app.css')
const skinsCss = read('src/lib/skins/skins.css')

// In-memory localStorage stand-in for persistence tests.
function fakeStorage(seed: Record<string, string> = {}): {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
} {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v)
  }
}

describe('SkinContract coverage', () => {
  it('app.css :root defines a default for every contract token', () => {
    const missing = SKIN_TOKENS.filter((t) => {
      const cssVar = tokenToCssVar(t) // e.g. --color-bg-base
      return !new RegExp(`${cssVar}\\s*:`).test(appCss)
    })
    expect(missing).toEqual([])
  })

  it('no component reads a token outside the contract namespaces', () => {
    // Guard against the old ad-hoc vocab (--bg/--surface/--text/...) creeping
    // back. Allowed prefixes are the contract + the documented shell chrome.
    const allowed = /^--(color-|radius-|shadow-|space-|font-|motion-|wave-|app-|titlebar-h)/
    const files = [
      'src/lib/Nav.svelte',
      'src/lib/Titlebar.svelte',
      'src/lib/views/Home.svelte',
      'src/lib/views/Plugins.svelte',
      'src/lib/views/Settings.svelte',
      'src/lib/plugins/PluginCard.svelte',
      'src/lib/ui/Badge.svelte',
      'src/lib/ui/ToggleBadge.svelte',
      'src/lib/ui/ToggleSwitch.svelte'
    ]
    const offenders: string[] = []
    for (const f of files) {
      const src = read(f)
      for (const m of src.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const v = m[1] ?? ''
        if (!allowed.test(v)) offenders.push(`${f}: ${v}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('built-in skins', () => {
  it('every registered skin has a matching CSS block, and vice versa', () => {
    const cssIds = [...skinsCss.matchAll(/:root\[data-skin='([^']+)'\]/g)].map((m) => m[1] ?? '')
    const regIds = SKINS.map((s) => s.id)
    expect([...new Set(cssIds)].sort()).toEqual([...regIds].sort())
  })

  it('the default skin is registered', () => {
    expect(SKINS.some((s) => s.id === DEFAULT_SKIN)).toBe(true)
  })

  it('each skin redefines the core palette tokens', () => {
    // Each [data-skin] block must at least re-anchor bg.base, text.primary and
    // accent so switching never leaves a half-applied palette.
    for (const skin of SKINS) {
      const block = new RegExp(`:root\\[data-skin='${skin.id}'\\]\\s*\\{([^}]*)\\}`).exec(skinsCss)
      expect(block, `missing block for ${skin.id}`).toBeTruthy()
      const body = block![1]
      for (const v of ['--color-bg-base', '--color-text-primary', '--color-accent']) {
        expect(body, `${skin.id} missing ${v}`).toContain(v)
      }
    }
  })
})

describe('skin resolution + persistence', () => {
  it('resolves known ids and rejects unknown ones', () => {
    expect(isSkinId('infernal')).toBe(true)
    expect(isSkinId('nope')).toBe(false)
    expect(resolveSkin('cathedral')).toBe('cathedral')
    expect(resolveSkin('nope')).toBe(DEFAULT_SKIN)
    expect(resolveSkin(undefined)).toBe(DEFAULT_SKIN)
  })

  it('reads the stored skin, falling back to default on junk', () => {
    expect(readSkin(fakeStorage({ 'iblis.skin': 'infernal' }))).toBe('infernal')
    expect(readSkin(fakeStorage({ 'iblis.skin': 'bogus' }))).toBe(DEFAULT_SKIN)
    expect(readSkin(fakeStorage())).toBe(DEFAULT_SKIN)
  })

  it('persists only valid ids', () => {
    const store = fakeStorage()
    writeSkin('cathedral', store)
    expect(store.getItem('iblis.skin')).toBe('cathedral')
    writeSkin('garbage', store)
    expect(store.getItem('iblis.skin')).toBe(DEFAULT_SKIN)
  })

  it('applySkin flips the data-skin attribute (validated)', () => {
    let applied = ''
    const el = { setAttribute: (_: string, v: string) => void (applied = v) }
    applySkin('light-paper', el)
    expect(applied).toBe('light-paper')
    applySkin('garbage', el)
    expect(applied).toBe(DEFAULT_SKIN)
  })
})
