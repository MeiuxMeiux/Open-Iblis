// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { isSkinToken, SKIN_TOKENS, tokenToCssVar, unknownSkinTokens } from '../src/index.js'

describe('skin contract', () => {
  it('maps dotted tokens to CSS custom properties', () => {
    expect(tokenToCssVar('color.bg.base')).toBe('--color-bg-base')
    expect(tokenToCssVar('motion.duration-fast')).toBe('--motion-duration-fast')
  })

  it('recognizes contract tokens', () => {
    expect(isSkinToken('color.accent')).toBe(true)
    expect(isSkinToken('color.made.up')).toBe(false)
  })

  it('flags unknown token keys', () => {
    const unknown = unknownSkinTokens({ 'color.accent': '#fff', 'color.bogus': '#000' })
    expect(unknown).toEqual(['color.bogus'])
  })

  it('has a non-trivial, unique token set', () => {
    expect(SKIN_TOKENS.length).toBeGreaterThan(40)
    expect(new Set(SKIN_TOKENS).size).toBe(SKIN_TOKENS.length)
  })
})
