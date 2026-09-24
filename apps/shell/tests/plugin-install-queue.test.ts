// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { errorMessage } from '../electron/main/error-message'
import { PluginInstallQueue } from '../electron/main/plugins/install-queue'

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => (resolve = done)), resolve }
}

describe('PluginInstallQueue', () => {
  it('runs installs in FIFO order and reports queued positions', async () => {
    const queue = new PluginInstallQueue<string>()
    const first = deferred<string>()
    const seen: string[] = []
    const updates: string[][] = []
    queue.subscribe((snapshot) =>
      updates.push(snapshot.entries.map((entry) => `${entry.id}:${entry.position}`))
    )

    const a = queue.enqueue(
      'one',
      '1.0.0',
      async () => {
        seen.push('one')
        return first.promise
      },
      () => 'one cancelled',
      () => 'one failed',
      (value) => ({ outcome: value.includes('cancelled') ? 'cancelled' : 'completed' })
    )
    const b = queue.enqueue(
      'two',
      '1.0.0',
      async () => {
        seen.push('two')
        return 'two done'
      },
      () => 'two cancelled',
      () => 'two failed',
      (value) => ({ outcome: value.includes('cancelled') ? 'cancelled' : 'completed' })
    )

    expect(queue.entries()).toEqual([
      { id: 'one', version: '1.0.0', phase: 'installing', position: 0 },
      { id: 'two', version: '1.0.0', phase: 'queued', position: 1 }
    ])
    expect(seen).toEqual(['one'])
    first.resolve('one done')
    await expect(a).resolves.toBe('one done')
    await expect(b).resolves.toBe('two done')
    expect(seen).toEqual(['one', 'two'])
    expect(updates.some((entries) => entries.join(',') === 'one:0,two:1')).toBe(true)
  })

  it('removes a waiting install without disturbing the active transfer', async () => {
    const queue = new PluginInstallQueue<string>()
    const first = deferred<string>()
    const a = queue.enqueue(
      'one',
      '1.0.0',
      async () => first.promise,
      () => 'one cancelled',
      () => 'one failed',
      (value) => ({ outcome: value.includes('cancelled') ? 'cancelled' : 'completed' })
    )
    const b = queue.enqueue(
      'two',
      '1.0.0',
      async () => 'two done',
      () => 'two cancelled',
      () => 'two failed',
      (value) => ({ outcome: value.includes('cancelled') ? 'cancelled' : 'completed' })
    )

    expect(queue.cancel('two')).toBe(true)
    expect(queue.entries()).toEqual([
      { id: 'one', version: '1.0.0', phase: 'installing', position: 0 }
    ])
    await expect(b).resolves.toBe('two cancelled')
    expect(queue.snapshot().history).toContainEqual(
      expect.objectContaining({ id: 'two', outcome: 'cancelled' })
    )
    first.resolve('one done')
    await expect(a).resolves.toBe('one done')
  })

  it('keeps an unexpected runner failure visible in recent history', async () => {
    const queue = new PluginInstallQueue<string>()
    const result = await queue.enqueue(
      'broken',
      '1.0.0',
      async () => Promise.reject(new Error('disk is unavailable')),
      () => 'cancelled',
      (error) => `failed: ${errorMessage(error)}`,
      (value) =>
        value.startsWith('failed:')
          ? { outcome: 'failed', message: value }
          : { outcome: 'completed' }
    )

    expect(result).toBe('failed: disk is unavailable')
    expect(queue.snapshot().history).toEqual([
      expect.objectContaining({
        id: 'broken',
        outcome: 'failed',
        message: 'failed: disk is unavailable'
      })
    ])
  })
})
