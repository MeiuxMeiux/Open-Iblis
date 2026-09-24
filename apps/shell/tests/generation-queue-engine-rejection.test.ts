// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { JobState } from '@iblis/plugin-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { createGenerationQueueScheduler } from '../electron/main/generation-queue/scheduler'
import { FakeEngine, memoryStore, request, waitFor } from './generation-queue-fixtures'

// An engine whose job promise rejects instead of settling to an error state.
class RejectingEngine extends FakeEngine {
  override settled(): Promise<JobState | undefined> {
    return Promise.reject(Object.assign(new Error('engine lost'), { code: 'engine_crashed' }))
  }
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}

afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
  unhandled.length = 0
})

describe('generation queue runner', () => {
  it('records a rejected engine job as an error without an unhandled rejection', async () => {
    process.on('unhandledRejection', onUnhandled)
    const queue = createGenerationQueueScheduler({
      store: memoryStore(),
      engine: new RejectingEngine(),
      sleep: () => new Promise((resolve) => setTimeout(resolve, 0))
    })
    await queue.init()
    await queue.enqueue(request('lost'))
    await waitFor(() => queue.snapshot().entries[0]?.status === 'failed')
    // Give Node a macrotask to surface any unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(queue.snapshot().entries[0]?.error).toMatchObject({
      code: 'engine_crashed',
      message: 'engine lost'
    })
    expect(unhandled).toEqual([])
  })
})
