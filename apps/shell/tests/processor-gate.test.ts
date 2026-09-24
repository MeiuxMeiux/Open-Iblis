// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  training: false,
  snapshot: { activeId: null as string | null, entries: [] as { status: string }[] }
}))

vi.mock('../electron/main/resource-state', () => ({
  resourceCoordinator: () => ({ trainingActive: () => state.training })
}))
vi.mock('../electron/main/generation-queue', () => ({
  queueSnapshot: () => Promise.resolve(state.snapshot)
}))

const { processorsMayRun } = await import('../electron/main/processor-gate')

describe('processor idle gate', () => {
  beforeEach(() => {
    state.training = false
    state.snapshot = { activeId: null, entries: [] }
  })

  it('runs when the queue is idle and no training is active', async () => {
    state.snapshot.entries = [{ status: 'completed' }, { status: 'failed' }]
    expect(await processorsMayRun()).toBe(true)
  })

  it('waits while training holds the GPU', async () => {
    state.training = true
    expect(await processorsMayRun()).toBe(false)
  })

  it('waits while a generation is active or pending', async () => {
    state.snapshot.activeId = 'job-1'
    expect(await processorsMayRun()).toBe(false)
    state.snapshot = { activeId: null, entries: [{ status: 'pending' }] }
    expect(await processorsMayRun()).toBe(false)
  })
})
