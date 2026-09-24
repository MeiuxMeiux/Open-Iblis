// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { parseSkinDescriptor } from '../src/index.js'

const valid = {
  id: 'mx.iblis.skin.boodark-nord',
  name: 'Boodark — Nord',
  version: '1.0.0',
  extends: 'dark-3d',
  theme: 'dark' as const,
  tokens: { 'color.bg.base': '#1f242c', 'color.accent': '#88c0d0' },
  css: 'extras.css'
}

describe('parseSkinDescriptor', () => {
  it('accepts a well-formed descriptor and echoes its fields', () => {
    const r = parseSkinDescriptor(valid)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.id).toBe('mx.iblis.skin.boodark-nord')
    expect(r.value.extends).toBe('dark-3d')
    expect(r.value.theme).toBe('dark')
    expect(r.value.css).toBe('extras.css')
    expect(r.value.tokens).toEqual({ 'color.bg.base': '#1f242c', 'color.accent': '#88c0d0' })
  })

  it('rejects a non-object', () => {
    expect(parseSkinDescriptor(null).ok).toBe(false)
    expect(parseSkinDescriptor([]).ok).toBe(false)
  })

  it('requires id, name, and a SemVer version', () => {
    expect(parseSkinDescriptor({ name: 'x', version: '1.0.0', tokens: valid.tokens }).ok).toBe(
      false
    )
    expect(
      parseSkinDescriptor({ id: 'x.y', name: '', version: '1.0.0', tokens: valid.tokens }).ok
    ).toBe(false)
    expect(
      parseSkinDescriptor({ id: 'x.y', name: 'X', version: 'nope', tokens: valid.tokens }).ok
    ).toBe(false)
  })

  it('filters tokens to the contract and drops junk', () => {
    const r = parseSkinDescriptor({
      id: 'x.y',
      name: 'X',
      version: '1.0.0',
      tokens: {
        'color.accent': '#fff',
        'bogus.token': '#000',
        'radius.md': 42, // non-string
        'font.size.body': 'z'.repeat(500) // over-long
      }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.tokens).toEqual({ 'color.accent': '#fff' })
  })

  it('rejects a descriptor with no surviving contract tokens', () => {
    const r = parseSkinDescriptor({
      id: 'x.y',
      name: 'X',
      version: '1.0.0',
      tokens: { nope: '#000' }
    })
    expect(r.ok).toBe(false)
  })

  it('rejects an invalid theme but allows it absent', () => {
    expect(parseSkinDescriptor({ ...valid, theme: 'sideways' }).ok).toBe(false)
    const { theme, ...noTheme } = valid
    void theme
    const r = parseSkinDescriptor(noTheme)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.theme).toBeUndefined()
  })
})
