// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { JobState } from '@iblis/plugin-sdk'
import type { QueueDocument, QueueEntry } from '../../../shared/generation-queue'
import type { QueueEngine } from './types'

const TERMINAL_STATUSES = ['done', 'failed', 'cancelled', 'interrupted']

interface QueueEntryRunnerOptions {
  engine: QueueEngine
  now: () => number
  sleep: (ms: number) => Promise<void>
  document: () => QueueDocument
  isShuttingDown: () => boolean
  cancelRequested: Set<string>
  save: () => Promise<void>
  emit: () => void
  prepareSettlement: () => void
  afterSettlement: () => void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function comparisonPeerFinished(document: QueueDocument, entry: QueueEntry): boolean {
  return entry.comparison
    ? document.entries.some(
        (peer) =>
          peer.id !== entry.id &&
          peer.comparison?.groupId === entry.comparison?.groupId &&
          TERMINAL_STATUSES.includes(peer.status)
      )
    : false
}

function carryComparisonBlueprint(
  document: QueueDocument,
  entry: QueueEntry,
  blueprint: string | undefined
): void {
  if (!entry.comparison || !blueprint) return
  const peer = document.entries.find(
    (candidate) =>
      candidate.id !== entry.id &&
      candidate.status === 'pending' &&
      candidate.comparison?.groupId === entry.comparison?.groupId
  )
  if (peer?.comparison) peer.comparison.internalBlueprint = blueprint
}

function clearFinishedComparisonBlueprints(document: QueueDocument, entry: QueueEntry): void {
  if (!entry.comparison) return
  const group = document.entries.filter(
    (peer) => peer.comparison?.groupId === entry.comparison?.groupId
  )
  if (group.every((peer) => TERMINAL_STATUSES.includes(peer.status))) {
    for (const peer of group) delete peer.comparison?.internalBlueprint
  }
}

export function createQueueEntryRunner(
  options: QueueEntryRunnerOptions
): (entry: QueueEntry) => Promise<void> {
  async function settle(entry: QueueEntry, state: JobState | undefined): Promise<void> {
    const document = options.document()
    entry.job = state
    entry.updatedAt = options.now()
    entry.finishedAt = entry.updatedAt
    if (options.isShuttingDown()) {
      entry.status = 'interrupted'
      entry.error = { code: 'interrupted', message: 'Iblis closed before this take finished' }
    } else if (state?.status === 'done') {
      entry.status = 'done'
    } else if (state?.error?.code === 'job_cancelled' && options.cancelRequested.has(entry.id)) {
      entry.status = 'cancelled'
      entry.error = state.error
    } else {
      entry.status = 'failed'
      entry.error = state?.error ?? {
        code: 'engine_lost',
        message: 'engine job did not settle'
      }
      document.paused = true
      document.pauseReason = entry.error.message
    }
    options.cancelRequested.delete(entry.id)
    clearFinishedComparisonBlueprints(document, entry)
    options.prepareSettlement()
    await options.save()
    options.emit()
    options.afterSettlement()
  }

  return async (entry: QueueEntry): Promise<void> => {
    try {
      if (options.isShuttingDown()) {
        await settle(entry, undefined)
        return
      }
      const document = options.document()
      if (comparisonPeerFinished(document, entry) && !entry.comparison?.internalBlueprint) {
        throw new Error('comparison blueprint is unavailable; abandon this pair')
      }
      const response = options.engine.start(
        clone(entry.request),
        entry.comparison?.internalBlueprint,
        entry.target ? clone(entry.target) : undefined
      )
      entry.jobId = response.jobId
      entry.updatedAt = options.now()
      await options.save()
      options.emit()
      if (options.cancelRequested.has(entry.id)) await options.engine.cancel(response.jobId)

      const terminal = options.engine.settled(response.jobId)
      // A holder object, not a local: the flag flips inside a callback, which
      // control-flow narrowing cannot see. Both handlers, so a rejected job
      // leaves no unhandled derived promise; the race below surfaces it.
      const watch = { done: false }
      const markDone = (): void => {
        watch.done = true
      }
      void terminal.then(markDone, markDone)
      for (;;) {
        await Promise.race([terminal, options.sleep(500)])
        if (watch.done) break
        options.emit()
      }
      const state = await terminal
      carryComparisonBlueprint(document, entry, options.engine.blueprint?.(response.jobId))
      await settle(entry, state)
    } catch (error) {
      // Engine rejections are untyped; read optional fields defensively.
      const caught = error as { code?: unknown; message?: unknown } | null | undefined
      const code: unknown = caught?.code ?? 'queue_engine_error'
      await settle(entry, {
        status: 'error',
        progress: entry.job?.progress ?? 0,
        error: {
          code: String(code),
          message: String(caught?.message ?? error)
        }
      })
    }
  }
}
