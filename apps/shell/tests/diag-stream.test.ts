// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'iblis-diag-'))

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false } }))
vi.mock('../electron/main/licensing', () => ({ currentLease: () => null }))
vi.mock('../electron/main/official-endpoints', () => ({
  requireServiceEndpoint: () => 'https://diag.test/api/v1/diag.php'
}))
vi.mock('../electron/main/diag/bundle', () => ({
  DIAG_SCHEMA: 'test',
  getInstallId: () => 'install-1',
  buildBundle: async () => ({})
}))

const { eventsSince, log } = await import('../electron/main/logger')
const { initDiagnostics } = await import('../electron/main/diag')

const msgs = (events: string[]): string[] =>
  events.map((e) => (JSON.parse(e) as { msg: string }).msg)

describe('logger eventsSince', () => {
  it('returns only events logged after the cursor', () => {
    const start = eventsSince(0).next
    log('info', 'a')
    log('info', 'b')
    const first = eventsSince(start)
    expect(msgs(first.events)).toEqual(['a', 'b'])
    expect(eventsSince(first.next).events).toEqual([])
    log('info', 'c')
    expect(msgs(eventsSince(first.next).events)).toEqual(['c'])
  })

  it('caps a stale cursor at the ring size', () => {
    for (let i = 0; i < 600; i++) log('debug', `n${i}`)
    expect(eventsSince(0).events).toHaveLength(500)
  })
})

describe('verbose streaming', () => {
  const posts: string[][] = []

  beforeEach(() => {
    vi.useFakeTimers()
    posts.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: Buffer }) => {
        posts.push((JSON.parse(gunzipSync(init.body).toString()) as { events: string[] }).events)
        return new Response(JSON.stringify({ ok: true, ref: 'diag-abcdef' }), { status: 200 })
      })
    )
    writeFileSync(join(userData, 'diag-level'), 'verbose')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends each breadcrumb once and stays quiet while idle', async () => {
    initDiagnostics()
    log('info', 'started')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(posts).toHaveLength(1)
    expect(msgs(posts[0]!)).toContain('started')

    await vi.advanceTimersByTimeAsync(10 * 30_000) // idle: nothing new, nothing sent
    expect(posts).toHaveLength(1)

    log('info', 'rendered')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(posts).toHaveLength(2)
    expect(msgs(posts[1]!)).toEqual(['rendered'])
  })
})
