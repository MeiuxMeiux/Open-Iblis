// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GenerateRequest, JobState } from '@iblis/plugin-sdk'
import type { QueueInsert, QueueSnapshot, QueueTarget } from '../../../shared/generation-queue'
import type { QueueStore } from './store'

export const MAX_PENDING = 32

export interface QueueEngine {
  // target is the entry's admitted provider snapshot; the provider runs that
  // exact target or throws an actionable error. Absent on legacy entries.
  start(request: GenerateRequest, blueprint?: string, target?: QueueTarget): { jobId: string }
  state(jobId: string): JobState | undefined
  settled(jobId: string): Promise<JobState | undefined>
  cancel(jobId: string): Promise<void>
  blueprint?(jobId: string): string | undefined
}

export interface QueueScheduler {
  init(): Promise<QueueSnapshot>
  snapshot(): QueueSnapshot
  enqueue(request: GenerateRequest, target?: QueueTarget): Promise<QueueSnapshot>
  enqueueBatch(entries: QueueInsert[]): Promise<QueueSnapshot>
  edit(id: string, request: GenerateRequest, target?: QueueTarget): Promise<QueueSnapshot>
  move(id: string, toIndex: number): Promise<QueueSnapshot>
  duplicate(id: string): Promise<QueueSnapshot>
  remove(id: string): Promise<QueueSnapshot>
  pause(): Promise<QueueSnapshot>
  resume(): Promise<QueueSnapshot>
  cancel(): Promise<QueueSnapshot>
  clear(): Promise<QueueSnapshot>
  revealComparison(groupId: string): Promise<QueueSnapshot>
  discardComparison(groupId: string): Promise<QueueSnapshot>
  shutdown(): Promise<void>
  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void
  isActive(): boolean
  inhibit(): Promise<() => Promise<void>>
  inhibitWhenQueueEmpty(): Promise<() => Promise<void>>
  acquireAdmission(): Promise<() => Promise<void>>
}

export interface SchedulerOptions {
  store: QueueStore
  engine: QueueEngine
  now?: () => number
  makeId?: () => string
  sleep?: (ms: number) => Promise<void>
}
