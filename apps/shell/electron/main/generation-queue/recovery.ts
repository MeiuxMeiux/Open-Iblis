// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { QueueDocument } from '../../../shared/generation-queue'
import type { QueueStore } from './store'

const LEGACY_CLOSED_WITH_UNFINISHED_WORK = 'Iblis closed with unfinished work.'
export const CLOSED_WITH_UNFINISHED_WORK = 'A previous Iblis session closed with unfinished work.'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function recoverQueueOnInit(
  loaded: Awaited<ReturnType<QueueStore['load']>>,
  now: () => number
): { document: QueueDocument; shouldSave: boolean } {
  const document = clone(loaded.document)
  let recovered = loaded.corrupt
  let changed = loaded.migrated ?? false

  if (
    document.paused &&
    document.pauseReason === LEGACY_CLOSED_WITH_UNFINISHED_WORK &&
    !document.entries.some((entry) => ['pending', 'running'].includes(entry.status))
  ) {
    // Alpha.9 and alpha.10 had no marker provenance and wrote this after every
    // clean quit. Terminal history, including an older interruption, is not
    // work that can resume; clear the legacy gate while preserving pendings.
    document.paused = false
    delete document.pauseReason
    changed = true
  }

  for (const entry of document.entries) {
    if (entry.status !== 'running') continue
    entry.status = 'interrupted'
    entry.finishedAt = now()
    entry.updatedAt = entry.finishedAt
    entry.error = { code: 'interrupted', message: 'Iblis closed before this take finished' }
    recovered = true
    changed = true
  }
  if (recovered) {
    document.paused = true
    document.pauseReason = loaded.corrupt
      ? 'Queue data was corrupt; recovery is paused.'
      : 'Interrupted work was recovered; review it before resuming.'
  }

  return { document, shouldSave: changed || recovered }
}
