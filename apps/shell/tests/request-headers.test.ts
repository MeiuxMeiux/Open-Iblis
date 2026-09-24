// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { withCredentialHeader } from '../electron/main/request-headers'

describe('withCredentialHeader', () => {
  it('keeps caller headers from every HeadersInit shape', () => {
    const shapes: RequestInit['headers'][] = [
      { 'Content-Type': 'application/json' },
      [['Content-Type', 'application/json']],
      new Headers({ 'Content-Type': 'application/json' })
    ]
    for (const init of shapes) {
      const headers = withCredentialHeader(init, 'X-Secret', 's3')
      expect(headers.get('content-type')).toBe('application/json')
      expect(headers.get('x-secret')).toBe('s3')
      expect(headers.has('0')).toBe(false)
    }
  })

  it('never lets a caller override the credential', () => {
    const headers = withCredentialHeader({ 'x-secret': 'forged' }, 'X-Secret', 'real')
    expect(headers.get('X-Secret')).toBe('real')
  })

  it('works without caller headers', () => {
    expect(withCredentialHeader(undefined, 'X-Secret', 'v').get('x-secret')).toBe('v')
  })
})
