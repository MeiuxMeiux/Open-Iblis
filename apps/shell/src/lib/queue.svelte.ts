// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GenerateRequest } from '@iblis/plugin-sdk'
import type { IpcResult } from '../../shared/contract'
import type { QueueEntry, QueueSnapshot } from '../../shared/generation-queue'
import type { QueueComparisonVariant } from '../../shared/generation-queue'

let snapshot = $state<QueueSnapshot | null>(null)
let loaded = $state(false)
let error = $state<string | null>(null)
let pendingAction = $state<string | null>(null)
let subscribed = false
let receivedPush = false

function accept(next: QueueSnapshot): void {
  snapshot = next
  loaded = true
  error = null
}

async function mutate(
  action: string,
  operation: () => Promise<IpcResult<QueueSnapshot>>
): Promise<boolean> {
  if (pendingAction) return false
  pendingAction = action
  try {
    const result = await operation()
    if (!result.ok) {
      error = result.error
      return false
    }
    accept(result.data)
    return true
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
    return false
  } finally {
    pendingAction = null
  }
}

function terminal(entry: QueueEntry): boolean {
  return ['done', 'failed', 'cancelled', 'interrupted'].includes(entry.status)
}

export const queue = {
  get snapshot(): QueueSnapshot | null {
    return snapshot
  },
  get entries(): QueueEntry[] {
    return snapshot?.entries ?? []
  },
  get active(): QueueEntry | null {
    if (!snapshot?.activeId) return null
    return snapshot.entries.find((entry) => entry.id === snapshot?.activeId) ?? null
  },
  get pending(): QueueEntry[] {
    return snapshot?.entries.filter((entry) => entry.status === 'pending') ?? []
  },
  get history(): QueueEntry[] {
    return snapshot ? [...snapshot.entries.filter(terminal)].reverse() : []
  },
  get pendingCount(): number {
    return snapshot?.pendingCount ?? 0
  },
  get paused(): boolean {
    return snapshot?.paused ?? false
  },
  get pauseReason(): string | null {
    return snapshot?.pauseReason ?? null
  },
  get loaded(): boolean {
    return loaded
  },
  get error(): string | null {
    return error
  },
  get pendingAction(): string | null {
    return pendingAction
  },

  async initialize(): Promise<void> {
    if (!subscribed) {
      subscribed = true
      window.iblis.queue.onSnapshot((next: QueueSnapshot) => {
        receivedPush = true
        accept(next)
      })
    }
    try {
      const result = await window.iblis.queue.snapshot()
      if (result.ok) {
        // A pushed snapshot can overtake the initial request. In that case the
        // push is the newer authority and the response must not roll it back.
        if (!receivedPush) accept(result.data)
      } else if (!receivedPush) {
        error = result.error
        loaded = true
      }
    } catch (cause) {
      if (!receivedPush) error = cause instanceof Error ? cause.message : String(cause)
      loaded = true
    }
  },

  // Requests are snapshotted: a $state proxy anywhere inside cannot cross IPC
  // (structured clone refuses proxies).
  enqueue(request: GenerateRequest): Promise<boolean> {
    return mutate('enqueue', () => window.iblis.queue.enqueue($state.snapshot(request)))
  },
  compare(request: GenerateRequest, variant: QueueComparisonVariant): Promise<boolean> {
    return mutate('compare', () => window.iblis.queue.compare($state.snapshot(request), variant))
  },
  edit(id: string, request: GenerateRequest): Promise<boolean> {
    return mutate(`edit:${id}`, () => window.iblis.queue.edit(id, $state.snapshot(request)))
  },
  move(id: string, toIndex: number): Promise<boolean> {
    return mutate(`move:${id}`, () => window.iblis.queue.move(id, toIndex))
  },
  duplicate(id: string): Promise<boolean> {
    return mutate(`duplicate:${id}`, () => window.iblis.queue.duplicate(id))
  },
  remove(id: string): Promise<boolean> {
    return mutate(`remove:${id}`, () => window.iblis.queue.remove(id))
  },
  pause(): Promise<boolean> {
    return mutate('pause', () => window.iblis.queue.pause())
  },
  resume(): Promise<boolean> {
    return mutate('resume', () => window.iblis.queue.resume())
  },
  cancel(): Promise<boolean> {
    return mutate('cancel', () => window.iblis.queue.cancel())
  },
  clear(): Promise<boolean> {
    return mutate('clear', () => window.iblis.queue.clear())
  },
  reveal(groupId: string): Promise<boolean> {
    return mutate(`reveal:${groupId}`, () => window.iblis.queue.reveal(groupId))
  },
  discardComparison(groupId: string): Promise<boolean> {
    return mutate(`discard:${groupId}`, () => window.iblis.queue.discardComparison(groupId))
  }
}
