// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { SKIN_TOKENS, tokenToCssVar } from '@iblis/plugin-sdk'
import {
  TOKEN_GROUPS,
  applyOverrides,
  clearOverride,
  clearSkinOverrides,
  filterGroups,
  getOverrides,
  readOverrides,
  setOverride,
  tokenKind
} from '../src/lib/skins/editor'

// In-memory localStorage stand-in (mirrors skins.test.ts).
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

// Minimal documentElement.style stand-in recording set/removed properties.
function fakeRoot(): {
  style: { setProperty(p: string, v: string): void; removeProperty(p: string): void }
  props: Map<string, string>
} {
  const props = new Map<string, string>()
  return {
    props,
    style: {
      setProperty: (p, v) => void props.set(p, v),
      removeProperty: (p) => void props.delete(p)
    }
  }
}

describe('token grid', () => {
  it('groups cover every contract token exactly once, in order', () => {
    const flat = TOKEN_GROUPS.flatMap((g) => g.tokens)
    expect(flat).toEqual([...SKIN_TOKENS])
  })

  it('classifies color/wave tokens as color, the rest as text', () => {
    expect(tokenKind('color.bg.base')).toBe('color')
    expect(tokenKind('wave.fg')).toBe('color')
    expect(tokenKind('radius.md')).toBe('text')
    expect(tokenKind('font.family.ui')).toBe('text')
    expect(tokenKind('motion.duration-fast')).toBe('text')
  })

  it('filters tokens by substring and drops empty groups', () => {
    const groups = filterGroups('radius')
    expect(groups.every((g) => g.tokens.every((t) => t.includes('radius')))).toBe(true)
    expect(groups.flatMap((g) => g.tokens).length).toBe(
      SKIN_TOKENS.filter((t) => t.includes('radius')).length
    )
    expect(filterGroups('nope-no-such-token')).toEqual([])
  })

  it('empty filter returns all groups (copied, not the frozen originals)', () => {
    const all = filterGroups('')
    expect(all.flatMap((g) => g.tokens)).toEqual([...SKIN_TOKENS])
    expect(all[0]?.tokens).not.toBe(TOKEN_GROUPS[0]?.tokens)
  })
})

describe('override persistence', () => {
  it('set/get round-trips per skin and validates on read', () => {
    const s = fakeStorage()
    setOverride('infernal', 'color.accent', '#ff0000', s)
    setOverride('cathedral', 'color.accent', '#d8a13a', s)
    expect(getOverrides('infernal', s)).toEqual({ 'color.accent': '#ff0000' })
    expect(getOverrides('cathedral', s)).toEqual({ 'color.accent': '#d8a13a' })
    expect(getOverrides('dark-3d', s)).toEqual({})
  })

  it('clearOverride drops one token, clearSkinOverrides drops the skin', () => {
    const s = fakeStorage()
    setOverride('infernal', 'color.accent', '#ff0000', s)
    setOverride('infernal', 'radius.md', '10px', s)
    clearOverride('infernal', 'radius.md', s)
    expect(getOverrides('infernal', s)).toEqual({ 'color.accent': '#ff0000' })
    clearSkinOverrides('infernal', s)
    expect(getOverrides('infernal', s)).toEqual({})
    expect(readOverrides(s)).toEqual({})
  })

  it('clearing the last token removes the skin entry entirely', () => {
    const s = fakeStorage()
    setOverride('infernal', 'color.accent', '#ff0000', s)
    clearOverride('infernal', 'color.accent', s)
    expect(readOverrides(s)).toEqual({})
  })

  it('sanitises junk: unknown tokens, non-strings, over-long values', () => {
    const s = fakeStorage({
      'iblis.skin.overrides': JSON.stringify({
        infernal: {
          'color.accent': '#ff0000',
          'bogus.token': '#000',
          'radius.md': 42,
          'font.size.body': 'x'.repeat(500)
        },
        garbage: 'not-an-object'
      })
    })
    expect(readOverrides(s)).toEqual({ infernal: { 'color.accent': '#ff0000' } })
  })

  it('survives malformed JSON', () => {
    expect(readOverrides(fakeStorage({ 'iblis.skin.overrides': '{not json' }))).toEqual({})
  })
})

describe('applyOverrides', () => {
  it('sets overridden tokens inline and clears the rest', () => {
    const s = fakeStorage()
    setOverride('infernal', 'color.accent', '#ff0000', s)
    const root = fakeRoot()
    // Pre-seed a stale inline prop that should be cleared.
    root.style.setProperty(tokenToCssVar('radius.md'), '99px')
    applyOverrides('infernal', root, s)
    expect(root.props.get(tokenToCssVar('color.accent'))).toBe('#ff0000')
    expect(root.props.has(tokenToCssVar('radius.md'))).toBe(false)
  })

  it('a skin with no overrides clears every contract property', () => {
    const root = fakeRoot()
    root.style.setProperty(tokenToCssVar('color.accent'), '#abcabc')
    applyOverrides('dark-3d', root, fakeStorage())
    expect(root.props.size).toBe(0)
  })
})
