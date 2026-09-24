// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activateRemote } from '../electron/main/licensing/remote'

function answer(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
  )
}

const activate = () => activateRemote('IBLIS-KEY', 'install', 'fp', ['a'], '0.2.0')

beforeEach(() => {
  // These cases exercise the official build's wire behavior.
  vi.stubEnv('IBLIS_OFFICIAL_BUILD', 'true')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('licensing remote client', () => {
  it('returns a grant from a well-formed answer', async () => {
    answer({
      ok: true,
      data: {
        lease: 'lease.sig',
        keyExpiresAt: '2027-01-01',
        activationsUsed: 1,
        maxActivations: 3
      }
    })
    expect(await activate()).toEqual({
      ok: true,
      grant: {
        lease: 'lease.sig',
        keyExpiresAt: '2027-01-01',
        activationsUsed: 1,
        maxActivations: 3
      }
    })
  })

  it('never stringifies non-string lease fields', async () => {
    answer({ ok: true, data: { lease: { forged: true }, keyExpiresAt: 7 } })
    const result = await activate()
    expect(result).toMatchObject({ ok: true, grant: { lease: '', keyExpiresAt: '' } })
  })

  it('passes server refusal codes through as values', async () => {
    answer({ ok: false, error: 'revoked', detail: 'key revoked' }, 403)
    expect(await activate()).toEqual({ ok: false, code: 'revoked', detail: 'key revoked' })
  })

  it('refuses with not-configured and no network call in a source build', async () => {
    vi.stubEnv('IBLIS_OFFICIAL_BUILD', 'false')
    vi.stubEnv('IBLIS_KEYS_BASE', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await activate()).toMatchObject({ ok: false, code: 'not-configured' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
