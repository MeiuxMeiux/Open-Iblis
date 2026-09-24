// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { errorMessage } from '../electron/main/error-message'

describe('errorMessage', () => {
  it('prefers an error-like message', () => {
    expect(errorMessage(new Error('disk full'))).toBe('disk full')
    expect(errorMessage({ message: 'plain object' })).toBe('plain object')
  })

  it('falls back to the value itself', () => {
    expect(errorMessage('boom')).toBe('boom')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage({ code: 'x' })).toBe('[object Object]')
  })

  it('never throws on null or undefined rejections', () => {
    expect(errorMessage(null)).toBe('null')
    expect(errorMessage(undefined)).toBe('undefined')
  })
})
