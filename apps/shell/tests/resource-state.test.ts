// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { createResourceCoordinator } from '../electron/main/resource-state/coordinator'
import { createGenerationQueueScheduler } from '../electron/main/generation-queue/scheduler'
import {
  GENERATION_PAUSED_WHILE_TRAINING,
  TRAINING_ALREADY_RUNNING,
  TRAINING_BLOCKED_BY_QUEUE
} from '../shared/training'
import { FakeEngine, memoryStore, request, waitFor } from './generation-queue-fixtures'

interface Harness {
  coordinator: ReturnType<typeof createResourceCoordinator>
  stops: number
  starts: number
}

function harness(overrides?: {
  acquireExclusive?: () => Promise<() => Promise<void>>
  stopEngine?: () => Promise<boolean>
  startEngine?: () => Promise<void>
}): Harness {
  const state: Harness = { coordinator: null as never, stops: 0, starts: 0 }
  state.coordinator = createResourceCoordinator({
    acquireExclusive: overrides?.acquireExclusive ?? (async () => async () => {}),
    stopEngine:
      overrides?.stopEngine ??
      (async () => {
        state.stops++
        return true
      }),
    startEngine:
      overrides?.startEngine ??
      (async () => {
        state.starts++
      })
  })
  return state
}

describe('resource coordinator', () => {
  it('walks idle -> training -> idle and emits each transition', async () => {
    const h = harness()
    const seen: string[] = []
    h.coordinator.subscribe((s) => seen.push(s.state))
    expect(h.coordinator.snapshot().state).toBe('idle')
    const release = await h.coordinator.beginTraining()
    expect(h.coordinator.snapshot().state).toBe('training')
    expect(h.coordinator.snapshot().detail).toBe(GENERATION_PAUSED_WHILE_TRAINING)
    await release()
    expect(h.coordinator.snapshot().state).toBe('idle')
    expect(seen).toEqual(['training', 'idle'])
  })

  it('refuses generation admission with calm copy while training', async () => {
    const h = harness()
    expect(h.coordinator.generationRefusal()).toBeNull()
    const release = await h.coordinator.beginTraining()
    expect(h.coordinator.generationRefusal()).toBe(GENERATION_PAUSED_WHILE_TRAINING)
    await release()
    expect(h.coordinator.generationRefusal()).toBeNull()
  })

  it('refuses a second concurrent training', async () => {
    const h = harness()
    const release = await h.coordinator.beginTraining()
    await expect(h.coordinator.beginTraining()).rejects.toThrow(TRAINING_ALREADY_RUNNING)
    await release()
  })

  it('stops the engine on begin and restores it exactly once on release', async () => {
    const h = harness()
    const release = await h.coordinator.beginTraining()
    expect(h.stops).toBe(1)
    expect(h.starts).toBe(0)
    await release()
    await release()
    expect(h.starts).toBe(1)
  })

  it('does not restart an engine that was not running', async () => {
    const h = harness({ stopEngine: async () => false })
    const release = await h.coordinator.beginTraining()
    await release()
    expect(h.starts).toBe(0)
  })

  it('releases the lease and stays idle when the engine stop fails', async () => {
    let released = 0
    const h = harness({
      acquireExclusive: async () => async () => {
        released++
      },
      stopEngine: async () => {
        throw new Error('stop failed')
      }
    })
    await expect(h.coordinator.beginTraining()).rejects.toThrow('stop failed')
    expect(released).toBe(1)
    expect(h.coordinator.snapshot().state).toBe('idle')
  })

  it('clears training state even when the engine restart fails', async () => {
    let leaseReleased = 0
    const h = harness({
      acquireExclusive: async () => async () => {
        leaseReleased++
      },
      startEngine: async () => {
        throw new Error('restart failed')
      }
    })
    const release = await h.coordinator.beginTraining()
    await expect(release()).rejects.toThrow('restart failed')
    expect(h.coordinator.snapshot().state).toBe('idle')
    expect(leaseReleased).toBe(1)
  })

  it('maps the queue-busy lease refusal to the training copy', async () => {
    const h = harness({
      acquireExclusive: async () => {
        throw new Error('empty the generation queue before running an engine compatibility proof')
      }
    })
    await expect(h.coordinator.beginTraining()).rejects.toThrow(TRAINING_BLOCKED_BY_QUEUE)
  })

  it('surfaces engine mutations without stopping the engine', async () => {
    const h = harness()
    const release = await h.coordinator.beginEngineMutation()
    expect(h.coordinator.snapshot().state).toBe('engine-mutation')
    expect(h.stops).toBe(0)
    await release()
    expect(h.coordinator.snapshot().state).toBe('idle')
  })

  it('reports generating from queue snapshots, with training taking precedence', async () => {
    const h = harness()
    h.coordinator.noteGenerating(true)
    expect(h.coordinator.snapshot().state).toBe('generating')
    const release = await h.coordinator.beginTraining()
    expect(h.coordinator.snapshot().state).toBe('training')
    await release()
    expect(h.coordinator.snapshot().state).toBe('generating')
    h.coordinator.noteGenerating(false)
    expect(h.coordinator.snapshot().state).toBe('idle')
  })
})

describe('resource coordinator against the real queue scheduler', () => {
  it('refuses training while the queue has work, both ways', async () => {
    const engine = new FakeEngine()
    const scheduler = createGenerationQueueScheduler({ store: memoryStore(), engine })
    await scheduler.init()
    const coordinator = createResourceCoordinator({
      acquireExclusive: () => scheduler.inhibitWhenQueueEmpty(),
      stopEngine: async () => true,
      startEngine: async () => {}
    })

    // Busy queue blocks training with the calm copy.
    await scheduler.enqueue(request('busy take'))
    await waitFor(() => engine.starts.length === 1)
    await expect(coordinator.beginTraining()).rejects.toThrow(TRAINING_BLOCKED_BY_QUEUE)
    engine.finish('job-1')
    await waitFor(() => !scheduler.isActive())

    // Active training blocks queue admission at the lease layer too.
    const release = await coordinator.beginTraining()
    await expect(scheduler.acquireAdmission()).rejects.toThrow()
    await release()

    // Released training frees admission again.
    const releaseAdmission = await scheduler.acquireAdmission()
    await releaseAdmission()
    await scheduler.shutdown()
  })

  it('gives an engine mutation exclusive ownership in both directions', async () => {
    const engine = new FakeEngine()
    const scheduler = createGenerationQueueScheduler({ store: memoryStore(), engine })
    await scheduler.init()
    const coordinator = createResourceCoordinator({
      acquireExclusive: () => scheduler.inhibitWhenQueueEmpty(),
      stopEngine: async () => true,
      startEngine: async () => {}
    })

    await scheduler.enqueue(request('busy take'))
    await waitFor(() => engine.starts.length === 1)
    await expect(coordinator.beginEngineMutation()).rejects.toThrow('empty the generation queue')
    engine.finish('job-1')
    await waitFor(() => !scheduler.isActive())

    const release = await coordinator.beginEngineMutation()
    await expect(scheduler.acquireAdmission()).rejects.toThrow('generation admission is paused')
    await release()
    const releaseAdmission = await scheduler.acquireAdmission()
    await releaseAdmission()
    await scheduler.shutdown()
  })
})
