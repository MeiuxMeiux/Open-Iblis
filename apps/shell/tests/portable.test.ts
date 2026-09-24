// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import {
  SKIN_FILE_EXT,
  buildDescriptor,
  parseSkinFile,
  serializeSkin,
  skinFileName
} from '../src/lib/skins/portable'

describe('buildDescriptor', () => {
  it('records the base as `extends`, keeps only contract tokens', () => {
    const d = buildDescriptor('infernal', {
      'color.accent': '#ff0000',
      'radius.md': '10px',
      // junk that must be dropped:
      'bogus.token': '#000',
      'font.size.body': 'x'.repeat(500)
    })
    expect(d.extends).toBe('infernal')
    expect(d.tokens).toEqual({ 'color.accent': '#ff0000', 'radius.md': '10px' })
    expect(d.theme).toBe('dark') // pulled from the SKINS registry
    expect(d.id).toBe('iblis.skin.infernal.custom')
    expect(d.name).toContain('Infernal')
    expect(d.version).toBe('1.0.0')
  })

  it('honours id/name/version overrides', () => {
    const d = buildDescriptor(
      'dark-3d',
      { 'color.accent': '#abcdef' },
      { id: 'my.id', name: 'My Skin', version: '2.1.0' }
    )
    expect(d).toMatchObject({ id: 'my.id', name: 'My Skin', version: '2.1.0' })
  })

  it('falls back gracefully for an unknown base id', () => {
    const d = buildDescriptor('nope', { 'color.accent': '#fff000' })
    expect(d.extends).toBe('nope')
    expect(d.name).toBe('nope')
    expect(d.theme).toBeUndefined()
  })
})

describe('serialize/parse round-trip', () => {
  it('a built descriptor parses back to the same tokens + base', () => {
    const d = buildDescriptor('cathedral', { 'color.accent': '#d8a13a', 'radius.lg': '14px' })
    const res = parseSkinFile(serializeSkin(d))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.skin.baseSkinId).toBe('cathedral')
    expect(res.skin.overrides).toEqual({ 'color.accent': '#d8a13a', 'radius.lg': '14px' })
    expect(res.skin.droppedTokens).toEqual([])
    expect(res.skin.baseFellBack).toBe(false)
    expect(res.skin.descriptor.name).toContain('Cathedral')
  })

  it('serialised body ends with a trailing newline', () => {
    expect(serializeSkin(buildDescriptor('dark-3d', { 'color.accent': '#fff' }))).toMatch(/}\n$/)
  })
})

describe('parseSkinFile validation', () => {
  it('rejects non-JSON', () => {
    const res = parseSkinFile('{not json')
    expect(res.ok).toBe(false)
  })

  it('rejects non-objects and arrays', () => {
    expect(parseSkinFile('"a string"').ok).toBe(false)
    expect(parseSkinFile('[1,2,3]').ok).toBe(false)
  })

  it('rejects a descriptor with no recognised tokens', () => {
    const res = parseSkinFile(JSON.stringify({ extends: 'infernal', tokens: { nope: '#000' } }))
    expect(res.ok).toBe(false)
  })

  it('keeps known tokens and reports dropped unknown ones', () => {
    const res = parseSkinFile(
      JSON.stringify({
        extends: 'infernal',
        tokens: { 'color.accent': '#ff0000', 'bogus.one': 'x', 'bogus.two': 'y' }
      })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.skin.overrides).toEqual({ 'color.accent': '#ff0000' })
    expect(res.skin.droppedTokens.sort()).toEqual(['bogus.one', 'bogus.two'])
  })

  it('falls back to the default skin when `extends` is unknown', () => {
    const res = parseSkinFile(
      JSON.stringify({ extends: 'who-knows', tokens: { 'color.accent': '#123456' } })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.skin.baseSkinId).toBe('dark-3d')
    expect(res.skin.baseFellBack).toBe(true)
  })

  it('supplies id/name/version defaults when absent', () => {
    const res = parseSkinFile(JSON.stringify({ tokens: { 'color.accent': '#123456' } }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.skin.baseSkinId).toBe('dark-3d') // no extends → default
    expect(res.skin.baseFellBack).toBe(false) // absent ≠ fell back
    expect(res.skin.descriptor.name).toBe('Imported skin')
    expect(res.skin.descriptor.version).toBe('1.0.0')
  })
})

describe('skinFileName', () => {
  it('slugifies and appends the extension', () => {
    expect(skinFileName('iblis.skin.infernal.custom')).toBe(
      `iblis-skin-infernal-custom${SKIN_FILE_EXT}`
    )
    expect(skinFileName('My Cool Skin!!')).toBe(`my-cool-skin${SKIN_FILE_EXT}`)
    expect(skinFileName('---')).toBe(`skin${SKIN_FILE_EXT}`)
  })
})
