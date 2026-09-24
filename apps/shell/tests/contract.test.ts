// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { err, ok, type IpcResult } from '../shared/contract'

describe('ipc result envelope', () => {
  it('wraps success as { ok: true, data }', () => {
    const r: IpcResult<number> = ok(42)
    expect(r).toEqual({ ok: true, data: 42 })
  })

  it('wraps failure as { ok: false, error }', () => {
    const r: IpcResult<never> = err('nope')
    expect(r).toEqual({ ok: false, error: 'nope' })
  })

  it('narrows on the ok discriminant', () => {
    const r: IpcResult<string> = ok('hi')
    expect(r.ok ? r.data : null).toBe('hi')
  })
})
