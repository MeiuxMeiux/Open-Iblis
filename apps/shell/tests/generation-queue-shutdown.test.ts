// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { createGenerationQueueScheduler } from '../electron/main/generation-queue/scheduler'
import type { QueueStore } from '../electron/main/generation-queue/store'
import { FakeEngine, memoryStore, request, waitFor } from './generation-queue-fixtures'

describe('generation queue shutdown and restart', () => {
  it('waits for an engine mutation lease during shutdown', async () => {
    const queue = createGenerationQueueScheduler({
      store: memoryStore(),
      engine: new FakeEngine()
    })
    await queue.init()
    const release = await queue.inhibit()
    let stopped = false
    const shutdown = queue.shutdown().then(() => (stopped = true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stopped).toBe(false)

    await release()
    await shutdown
    expect(stopped).toBe(true)
  })

  it('does not invent unfinished work when an idle queue shuts down', async () => {
    const store = memoryStore()
    const queue = createGenerationQueueScheduler({ store, engine: new FakeEngine() })
    await queue.init()
    await queue.shutdown()

    const engine = new FakeEngine()
    const reopened = createGenerationQueueScheduler({ store, engine })
    const snapshot = await reopened.init()
    expect(snapshot).toMatchObject({ paused: false, pendingCount: 0, entries: [] })
    expect(snapshot.pauseReason).toBeUndefined()

    await reopened.enqueue(request('starts normally'))
    await waitFor(() => engine.starts.length === 1)
    await reopened.cancel()
  })

  it('repairs the legacy close marker when no unfinished evidence exists', async () => {
    const queue = createGenerationQueueScheduler({
      store: memoryStore({
        version: 2,
        paused: true,
        pauseReason: 'Iblis closed with unfinished work.',
        entries: [
          {
            id: 'done',
            request: request('already finished'),
            status: 'done',
            createdAt: 1,
            updatedAt: 2,
            finishedAt: 2
          },
          {
            id: 'old-interruption',
            request: request('interrupted before a later idle quit'),
            status: 'interrupted',
            createdAt: 3,
            updatedAt: 4,
            finishedAt: 4,
            error: { code: 'interrupted', message: 'old interruption' }
          }
        ]
      }),
      engine: new FakeEngine()
    })

    const snapshot = await queue.init()
    expect(snapshot.paused).toBe(false)
    expect(snapshot.pauseReason).toBeUndefined()
    expect(snapshot.entries.map((entry) => entry.status)).toEqual(['done', 'interrupted'])
  })

  it('preserves a meaningful pause reason while pending work shuts down', async () => {
    const store = memoryStore({
      version: 2,
      paused: true,
      pauseReason: 'Engine timed out.',
      entries: [
        {
          id: 'pending-after-failure',
          request: request('still waiting after a failure'),
          status: 'pending',
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })
    const queue = createGenerationQueueScheduler({
      store,
      engine: new FakeEngine()
    })

    expect(await queue.init()).toMatchObject({ paused: true, pauseReason: 'Engine timed out.' })
    await queue.shutdown()
    const reopened = createGenerationQueueScheduler({ store, engine: new FakeEngine() })
    expect(await reopened.init()).toMatchObject({
      paused: true,
      pauseReason: 'Engine timed out.',
      pendingCount: 1
    })
  })

  it('records unfinished work when pending entries shut down', async () => {
    const store = memoryStore({
      version: 2,
      paused: true,
      entries: [
        {
          id: 'pending',
          request: request('still waiting'),
          status: 'pending',
          createdAt: 1,
          updatedAt: 1
        }
      ]
    })
    const queue = createGenerationQueueScheduler({ store, engine: new FakeEngine() })
    await queue.init()
    await queue.shutdown()

    const reopened = createGenerationQueueScheduler({ store, engine: new FakeEngine() })
    expect(await reopened.init()).toMatchObject({
      paused: true,
      pauseReason: 'A previous Iblis session closed with unfinished work.',
      pendingCount: 1
    })
  })

  it('waits for startup recovery before persisting shutdown', async () => {
    type Loaded = Awaited<ReturnType<QueueStore['load']>>
    let releaseLoad!: (loaded: Loaded) => void
    const loading = new Promise<Loaded>((resolve) => (releaseLoad = resolve))
    let saved: Parameters<QueueStore['replace']>[0] | null = null
    const store: QueueStore = {
      load: () => loading,
      async replace(document) {
        saved = JSON.parse(JSON.stringify(document)) as typeof document
      }
    }
    const queue = createGenerationQueueScheduler({ store, engine: new FakeEngine() })
    const initialized = queue.init()
    const shutdown = queue.shutdown()

    releaseLoad({
      corrupt: false,
      document: {
        version: 2,
        paused: false,
        entries: [
          {
            id: 'loaded-pending',
            request: request('must survive quick quit'),
            status: 'pending',
            createdAt: 1,
            updatedAt: 1
          }
        ]
      }
    })
    await Promise.all([initialized, shutdown])

    expect(saved).toMatchObject({
      paused: true,
      pauseReason: 'A previous Iblis session closed with unfinished work.',
      entries: [{ id: 'loaded-pending', status: 'pending' }]
    })
  })

  it('drains admission even when a queued mutation is rejected', async () => {
    const queue = createGenerationQueueScheduler({
      store: memoryStore(),
      engine: new FakeEngine()
    })
    await queue.init()
    const release = await queue.acquireAdmission()
    const shutdown = queue.shutdown()
    await expect(queue.enqueue(request('too late'))).rejects.toThrow('shutting down')
    await release()
    await shutdown
  })

  it('remembers active work that settles while shutdown drains a lease', async () => {
    const engine = new FakeEngine()
    const queue = createGenerationQueueScheduler({ store: memoryStore(), engine })
    await queue.init()
    await queue.enqueue(request('settles during shutdown'))
    await waitFor(() => engine.starts.length === 1)
    const release = await queue.acquireAdmission()

    const shutdown = queue.shutdown()
    engine.finish('job-1')
    await waitFor(() => queue.snapshot().entries[0]?.status === 'interrupted')
    await release()
    await shutdown

    expect(queue.snapshot()).toMatchObject({
      paused: true,
      pauseReason: 'A previous Iblis session closed with unfinished work.',
      entries: [{ status: 'interrupted' }]
    })
  })

  it('replaces pause-after-current copy when shutdown interrupts the active take', async () => {
    const engine = new FakeEngine()
    const store = memoryStore()
    const queue = createGenerationQueueScheduler({ store, engine })
    await queue.init()
    await queue.enqueue(request('active while closing'))
    await waitFor(() => engine.starts.length === 1)
    await queue.pause()
    expect(queue.snapshot().pauseReason).toBe('Paused after the current take.')

    await queue.shutdown()
    const reopened = createGenerationQueueScheduler({ store, engine: new FakeEngine() })
    expect(await reopened.init()).toMatchObject({
      paused: true,
      pauseReason: 'A previous Iblis session closed with unfinished work.',
      entries: [{ status: 'interrupted' }]
    })
  })

  it('does not start a take once shutdown wins the pre-start persistence race', async () => {
    const engine = new FakeEngine()
    let writes = 0
    let releaseRunningSave!: () => void
    const runningSave = new Promise<void>((resolve) => (releaseRunningSave = resolve))
    const store: QueueStore = {
      async load() {
        return { document: { version: 2 as const, paused: false, entries: [] }, corrupt: false }
      },
      async replace() {
        writes++
        if (writes === 2) await runningSave
      }
    }
    const queue = createGenerationQueueScheduler({ store, engine })
    await queue.init()
    await queue.enqueue(request('must not start'))
    const shutdown = queue.shutdown()
    releaseRunningSave()
    await shutdown

    expect(engine.starts).toHaveLength(0)
    expect(queue.snapshot()).toMatchObject({
      paused: true,
      pauseReason: 'A previous Iblis session closed with unfinished work.',
      entries: [{ status: 'interrupted' }]
    })
  })
})
