// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The mutual-exclusion truth both Create and Training consult. Pure factory:
// the queue lease, engine stop/start, and clock are injected, so state
// transitions and the stop/restore-in-finally contract are unit-testable.
// docs/training/02-shell-training-ui.md "Resource-state module".

import {
  ENGINE_CHANGE_IN_PROGRESS,
  GENERATION_PAUSED_WHILE_TRAINING,
  TRAINING_ALREADY_RUNNING,
  TRAINING_BLOCKED_BY_QUEUE,
  type ResourceState
} from '../../../shared/training'
import { ignoreFailure } from '../ignore-failure'
import { errorMessage } from '../error-message'

export interface ResourceCoordinatorDeps {
  // Resolves once the queue is empty-and-inhibited; rejects if work exists.
  acquireExclusive(): Promise<() => Promise<void>>
  // Stops the engine sidecar to free its resident VRAM. Resolves with whether
  // it was running, so release only restarts what training actually stopped.
  stopEngine(): Promise<boolean>
  startEngine(): Promise<void>
  now?: () => number
}

export interface ResourceCoordinator {
  snapshot(): ResourceState
  subscribe(listener: (state: ResourceState) => void): () => void
  // Reflects generation activity pushed from the queue's snapshot stream.
  noteGenerating(active: boolean): void
  // Why enqueue must be refused right now, or null when admission is fine.
  generationRefusal(): string | null
  trainingActive(): boolean
  // Acquires the training lock: exclusive queue lease, engine stopped. The
  // returned release restores the engine and frees the lease — always call it
  // from a finally so a crashed or cancelled training still restores Create.
  beginTraining(): Promise<() => Promise<void>>
  // Same lease used by engine installs/proofs, surfaced as engine-mutation.
  beginEngineMutation(): Promise<() => Promise<void>>
}

export function createResourceCoordinator(deps: ResourceCoordinatorDeps): ResourceCoordinator {
  const now = deps.now ?? Date.now
  let training = false
  let mutations = 0
  let generating = false
  let since = now()
  const listeners = new Set<(state: ResourceState) => void>()

  function snapshot(): ResourceState {
    if (training) {
      return { state: 'training', detail: GENERATION_PAUSED_WHILE_TRAINING, since }
    }
    if (mutations > 0) {
      return { state: 'engine-mutation', detail: ENGINE_CHANGE_IN_PROGRESS, since }
    }
    if (generating) return { state: 'generating', detail: null, since }
    return { state: 'idle', detail: null, since }
  }

  function emit(): void {
    since = now()
    const state = snapshot()
    for (const listener of listeners) listener(state)
  }

  async function acquireExclusiveOrExplain(): Promise<() => Promise<void>> {
    if (training) throw new Error(TRAINING_ALREADY_RUNNING)
    try {
      return await deps.acquireExclusive()
    } catch (error) {
      // The queue lease's own refusal is precise but engine-flavored; the
      // training surfaces promise calm, user-facing copy instead.
      const message = errorMessage(error)
      throw new Error(
        message.includes('empty the generation queue') ? TRAINING_BLOCKED_BY_QUEUE : message,
        { cause: error }
      )
    }
  }

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    noteGenerating(active) {
      if (generating === active) return
      generating = active
      emit()
    },
    generationRefusal() {
      if (training) return GENERATION_PAUSED_WHILE_TRAINING
      if (mutations > 0) return ENGINE_CHANGE_IN_PROGRESS
      return null
    },
    trainingActive() {
      return training
    },
    async beginTraining() {
      const releaseLease = await acquireExclusiveOrExplain()
      let engineWasRunning = false
      try {
        engineWasRunning = await deps.stopEngine()
      } catch (error) {
        await releaseLease().catch(ignoreFailure)
        throw error
      }
      training = true
      emit()
      let released = false
      return async () => {
        if (released) return
        released = true
        try {
          if (engineWasRunning) await deps.startEngine()
        } finally {
          training = false
          emit()
          await releaseLease().catch(ignoreFailure)
        }
      }
    },
    async beginEngineMutation() {
      if (training) throw new Error(TRAINING_ALREADY_RUNNING)
      const releaseLease = await deps.acquireExclusive()
      mutations++
      emit()
      let released = false
      return async () => {
        if (released) return
        released = true
        mutations = Math.max(0, mutations - 1)
        emit()
        await releaseLease().catch(ignoreFailure)
      }
    }
  }
}
