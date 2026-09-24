// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { JobState } from '@iblis/plugin-sdk'
import type { QueueDocument, QueueEntry, QueueSnapshot } from '../../../shared/generation-queue'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createQueueSnapshot(
  document: QueueDocument,
  active: QueueEntry | null,
  engineState: (jobId: string) => JobState | undefined
): QueueSnapshot {
  const entries = document.entries.map(({ comparison, ...entry }) => ({
    ...clone(entry),
    ...(comparison
      ? {
          comparison: {
            groupId: comparison.groupId,
            blindLabel: comparison.blindLabel,
            revealed: comparison.revealed
          }
        }
      : {})
  }))
  const activeEntry = active ? entries.find((entry) => entry.id === active.id) : undefined
  if (activeEntry?.jobId) activeEntry.job = engineState(activeEntry.jobId)
  return {
    version: 1,
    paused: document.paused,
    ...(document.pauseReason ? { pauseReason: document.pauseReason } : {}),
    entries,
    ...(active ? { activeId: active.id } : {}),
    pendingCount: document.entries.filter((entry) => entry.status === 'pending').length
  }
}
