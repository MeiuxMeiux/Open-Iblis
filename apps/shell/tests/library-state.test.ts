// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { createRefreshExecutor, createSerialExecutor } from '../src/lib/library/serial-executor'

describe('renderer library state serialization', () => {
  it('applies a slow refresh before the mutation invoked after it', async () => {
    const run = createSerialExecutor()
    const events: string[] = []
    let release!: () => void
    const waiting = new Promise<void>((resolve) => (release = resolve))

    const refresh = run(async () => {
      events.push('refresh-start')
      await waiting
      events.push('refresh-apply')
    })
    const mutation = run(async () => events.push('mutation-apply'))
    await Promise.resolve()
    expect(events).toEqual(['refresh-start'])
    release()
    await Promise.all([refresh, mutation])
    expect(events).toEqual(['refresh-start', 'refresh-apply', 'mutation-apply'])
  })

  it('continues after a rejected operation', async () => {
    const run = createSerialExecutor()
    await expect(
      run(async () => {
        throw new Error('IPC unavailable')
      })
    ).rejects.toThrow('IPC unavailable')
    await expect(run(async () => 'recovered')).resolves.toBe('recovered')
  })

  it('runs a follow-up load when refresh is requested during an active load', async () => {
    const run = createSerialExecutor()
    let calls = 0
    let release!: () => void
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const refresh = createRefreshExecutor(async () => {
      calls++
      if (calls === 1) await waiting
    }, run)

    const first = refresh()
    await Promise.resolve()
    const second = refresh()
    expect(calls).toBe(1)
    release()
    await Promise.all([first, second])
    expect(calls).toBe(2)
  })

  it('does not lose a refresh requested as the final load settles', async () => {
    const run = createSerialExecutor()
    let calls = 0
    let release!: () => void
    const waiting = new Promise<void>((resolve) => (release = resolve))
    const refresh = createRefreshExecutor(async () => {
      calls++
      if (calls === 1) await waiting
    }, run)

    const first = refresh()
    await Promise.resolve()
    release()
    await Promise.resolve()
    const second = refresh()
    await Promise.all([first, second])
    expect(calls).toBe(2)
  })
})
