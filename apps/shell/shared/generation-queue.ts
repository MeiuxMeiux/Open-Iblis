// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GenerateRequest, JobError, JobState } from '@iblis/plugin-sdk'

export type QueueEntryStatus =
  'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'

export interface QueueComparison {
  groupId: string
  blindLabel: 'A' | 'B'
  revealed: boolean
  /** Main-only persisted LM result; stripped from every renderer snapshot. */
  internalBlueprint?: string
}

export interface QueueComparisonVariant {
  profileId: string
  steps?: number
  guidance?: number
}

// The exact provider identity a take was admitted against. Execution runs
// this target or fails with an actionable error — installing, updating, or
// switching engines never silently retargets pending work.
export interface QueueTarget {
  pluginId: string
  version: string
  protocol: 1 | 2
  // sha256 of the signed v2 descriptor the recipe was validated against.
  descriptorHash?: string
}

export interface QueueInsert {
  request: GenerateRequest
  comparison?: QueueComparison
  target?: QueueTarget
}

export interface QueueEntry {
  id: string
  request: GenerateRequest
  status: QueueEntryStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  jobId?: string
  job?: JobState
  error?: JobError
  comparison?: QueueComparison
  target?: QueueTarget
}

export interface QueueSnapshot {
  version: 1
  paused: boolean
  pauseReason?: string
  entries: QueueEntry[]
  activeId?: string
  pendingCount: number
}

export interface QueueDocument {
  version: 2
  paused: boolean
  pauseReason?: string
  entries: QueueEntry[]
}
