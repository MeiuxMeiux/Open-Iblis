// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  QueueDocument,
  QueueEntry,
  QueueInsert,
  QueueSnapshot
} from '../../../shared/generation-queue'
import {
  abandonComparison,
  checkPendingCap,
  keepWhenClearing,
  pruneHistory,
  validateBatch
} from './comparison'
import { createQueueLeases } from './leases'
import { CLOSED_WITH_UNFINISHED_WORK, recoverQueueOnInit } from './recovery'
import { createQueueEntryRunner } from './runner'
import { createQueueSnapshot } from './snapshot'
import { MAX_PENDING, type QueueScheduler, type SchedulerOptions } from './types'
import { ignoreFailure } from '../ignore-failure'

export { MAX_PENDING, type QueueEngine, type QueueScheduler } from './types'
const MAX_HISTORY = 64

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createGenerationQueueScheduler(options: SchedulerOptions): QueueScheduler {
  const now = options.now ?? Date.now
  const makeId = options.makeId ?? (() => crypto.randomUUID())
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const listeners = new Set<(snapshot: QueueSnapshot) => void>()
  const cancelRequested = new Set<string>()
  let document: QueueDocument = { version: 2, paused: false, entries: [] }
  let initialized = false
  let active: QueueEntry | null = null
  let activeRun: Promise<void> | null = null
  let initRun: Promise<QueueSnapshot> | null = null
  let shuttingDown = false
  const leases = createQueueLeases()
  let saveChain = Promise.resolve()
  let commandChain = Promise.resolve()

  function view(): QueueSnapshot {
    return createQueueSnapshot(document, active, (jobId) => options.engine.state(jobId))
  }

  function emit(): void {
    const current = view()
    for (const listener of listeners) {
      try {
        listener(current)
      } catch {
        // A destroyed renderer or diagnostic subscriber must not fail a queue
        // transition after it has already persisted.
      }
    }
  }

  function save(): Promise<void> {
    const next = clone(document)
    saveChain = saveChain.catch(ignoreFailure).then(() => options.store.replace(next))
    return saveChain
  }

  function command<T>(operation: () => Promise<T>, allowShutdown = false): Promise<T> {
    const result = commandChain.catch(ignoreFailure).then(() => {
      if (shuttingDown && !allowShutdown) throw new Error('generation queue is shutting down')
      return operation()
    })
    commandChain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  function pending(id: string): QueueEntry {
    const entry = document.entries.find((candidate) => candidate.id === id)
    if (entry?.status !== 'pending') throw new Error(`queue entry ${id} is not pending`)
    if (entry.comparison) {
      throw new Error('comparison candidates cannot be changed individually')
    }
    return entry
  }

  function prune(): void {
    pruneHistory(document, MAX_HISTORY)
  }

  async function append(entries: QueueInsert[]): Promise<QueueSnapshot> {
    validateBatch(document, entries)
    checkPendingCap(document, entries.length, MAX_PENDING)
    const at = now()
    for (const entry of entries) {
      document.entries.push({
        id: makeId(),
        request: clone(entry.request),
        ...(entry.comparison ? { comparison: clone(entry.comparison) } : {}),
        ...(entry.target ? { target: clone(entry.target) } : {}),
        status: 'pending',
        createdAt: at,
        updatedAt: at
      })
    }
    const result = await changed()
    pump()
    return result
  }

  function pump(): void {
    if (
      !initialized ||
      shuttingDown ||
      leases.inhibited ||
      document.paused ||
      active ||
      activeRun
    ) {
      return
    }
    const entry = document.entries.find((candidate) => candidate.status === 'pending')
    if (!entry) return
    active = entry
    entry.status = 'running'
    entry.startedAt = now()
    entry.updatedAt = entry.startedAt
    activeRun = save()
      .then(() => {
        emit()
        return runEntry(entry)
      })
      .finally(() => {
        activeRun = null
        if (!document.paused) pump()
      })
  }

  async function changed(): Promise<QueueSnapshot> {
    await save()
    emit()
    return view()
  }

  async function initialize(): Promise<QueueSnapshot> {
    const recovered = recoverQueueOnInit(await options.store.load(), now)
    document = recovered.document
    if (recovered.shouldSave) await save()
    initialized = true
    emit()
    pump()
    return view()
  }

  const runEntry = createQueueEntryRunner({
    engine: options.engine,
    now,
    sleep,
    document: () => document,
    isShuttingDown: () => shuttingDown,
    cancelRequested,
    save,
    emit,
    prepareSettlement: () => {
      active = null
      prune()
    },
    afterSettlement: () => {
      if (!document.paused && !shuttingDown) pump()
    }
  })

  const scheduler: QueueScheduler = {
    init(): Promise<QueueSnapshot> {
      if (initialized) return Promise.resolve(view())
      initRun ??= initialize().finally(() => {
        initRun = null
      })
      return initRun
    },

    snapshot: view,

    enqueue(request, target): Promise<QueueSnapshot> {
      return command(() => append([{ request, ...(target ? { target } : {}) }]))
    },

    enqueueBatch(entries): Promise<QueueSnapshot> {
      return command(() => append(entries))
    },

    edit(id, request, target): Promise<QueueSnapshot> {
      return command(async () => {
        const entry = pending(id)
        entry.request = clone(request)
        // Editing re-admits: fresh target snapshot.
        if (target) entry.target = clone(target)
        else delete entry.target
        entry.updatedAt = now()
        return changed()
      })
    },

    move(id, toIndex): Promise<QueueSnapshot> {
      return command(async () => {
        const moving = pending(id)
        const pendings = document.entries.filter(
          (entry) => entry.status === 'pending' && entry.id !== id
        )
        pendings.splice(Math.max(0, Math.min(Math.trunc(toIndex), pendings.length)), 0, moving)
        document.entries = [
          ...document.entries.filter((entry) => entry.status !== 'pending'),
          ...pendings
        ]
        moving.updatedAt = now()
        return changed()
      })
    },

    duplicate(id): Promise<QueueSnapshot> {
      return command(async () => {
        checkPendingCap(document, 1, MAX_PENDING)
        const source = pending(id)
        const at = now()
        const copy: QueueEntry = {
          id: makeId(),
          request: clone(source.request),
          ...(source.target ? { target: clone(source.target) } : {}),
          status: 'pending',
          createdAt: at,
          updatedAt: at
        }
        document.entries.splice(document.entries.indexOf(source) + 1, 0, copy)
        return changed()
      })
    },

    remove(id): Promise<QueueSnapshot> {
      return command(async () => {
        const entry = pending(id)
        document.entries.splice(document.entries.indexOf(entry), 1)
        return changed()
      })
    },

    pause(): Promise<QueueSnapshot> {
      return command(async () => {
        document.paused = true
        document.pauseReason = active ? 'Paused after the current take.' : 'Queue paused.'
        return changed()
      })
    },

    resume(): Promise<QueueSnapshot> {
      return command(async () => {
        document.paused = false
        delete document.pauseReason
        const result = await changed()
        pump()
        return result
      })
    },

    cancel(): Promise<QueueSnapshot> {
      return command(async () => {
        document.paused = true
        document.pauseReason = 'Current take stopped. Resume when ready.'
        const entry = active
        if (!entry) return changed()
        cancelRequested.add(entry.id)
        await save()
        emit()
        if (entry.jobId) await options.engine.cancel(entry.jobId)
        await activeRun
        return view()
      })
    },

    clear(): Promise<QueueSnapshot> {
      return command(async () => {
        document.entries = document.entries.filter((entry) =>
          keepWhenClearing(entry, document.entries)
        )
        return changed()
      })
    },

    revealComparison(groupId): Promise<QueueSnapshot> {
      return command(async () => {
        const group = document.entries.filter((entry) => entry.comparison?.groupId === groupId)
        if (group.length !== 2) throw new Error('comparison group is unavailable')
        if (group.some((entry) => ['pending', 'running'].includes(entry.status))) {
          throw new Error('comparison can be revealed after both candidates finish')
        }
        for (const entry of group) {
          // Always set: the group was selected by comparison.groupId.
          if (entry.comparison) entry.comparison.revealed = true
          entry.updatedAt = now()
        }
        return changed()
      })
    },

    discardComparison(groupId): Promise<QueueSnapshot> {
      return command(async () => {
        abandonComparison(document, groupId, now())
        return changed()
      })
    },

    async shutdown(): Promise<void> {
      const hadActiveWork = !!active
      const initializing = initRun
      shuttingDown = true
      if (initializing) await initializing
      if (!initialized) return
      await leases.drain()
      await command(async () => {
        const entry = active
        const hasUnfinishedWork =
          hadActiveWork ||
          !!entry ||
          document.entries.some((candidate) => candidate.status === 'pending')
        if (hasUnfinishedWork) {
          document.paused = true
          if (hadActiveWork || entry || !document.pauseReason) {
            document.pauseReason = CLOSED_WITH_UNFINISHED_WORK
          }
        }
        if (entry) {
          entry.status = 'interrupted'
          entry.updatedAt = now()
          entry.finishedAt = entry.updatedAt
          entry.error = { code: 'interrupted', message: 'Iblis closed before this take finished' }
          cancelRequested.add(entry.id)
        }
        await save()
        if (entry?.jobId) await options.engine.cancel(entry.jobId)
        await activeRun
      }, true)
    },

    subscribe(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    isActive(): boolean {
      return active !== null
    },

    inhibit(): Promise<() => Promise<void>> {
      return command(async () => {
        const controlledPairPending = document.entries.some(
          (entry) =>
            !!entry.comparison &&
            !entry.comparison.revealed &&
            ['pending', 'running'].includes(entry.status)
        )
        const release = leases.inhibit(
          active
            ? 'engine changes are unavailable during an active generation'
            : controlledPairPending
              ? 'finish or abandon the controlled comparison before changing the engine'
              : undefined
        )
        return async () => {
          await release()
          pump()
        }
      })
    },

    inhibitWhenQueueEmpty(): Promise<() => Promise<void>> {
      return command(async () => {
        const pending = document.entries.some((entry) =>
          ['pending', 'running'].includes(entry.status)
        )
        const release = leases.inhibit(
          pending
            ? 'empty the generation queue before running an engine compatibility proof'
            : undefined
        )
        return async () => {
          await release()
          pump()
        }
      })
    },

    acquireAdmission(): Promise<() => Promise<void>> {
      return command(async () => leases.acquireAdmission())
    }
  }

  return scheduler
}
