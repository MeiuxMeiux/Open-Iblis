// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GenerateRequest } from '@iblis/plugin-sdk'
import type { QueueDocument, QueueEntry, QueueInsert } from '../../../shared/generation-queue'

export const MAX_UNREVEALED_COMPARISONS = 16

// Engine-neutral batching: which request is the control and whether the pair
// is a valid recipe was already decided by the provider that resolved it.
export function buildBlindComparison(
  control: GenerateRequest,
  candidate: GenerateRequest,
  controlIsA: boolean,
  groupId: string
): QueueInsert[] {
  const candidates = controlIsA ? [control, candidate] : [candidate, control]
  return candidates.map((request, index) => ({
    request,
    comparison: { groupId, blindLabel: index === 0 ? 'A' : 'B', revealed: false }
  }))
}

function isTerminal(entry: QueueEntry): boolean {
  return ['done', 'failed', 'cancelled', 'interrupted'].includes(entry.status)
}

export function checkPendingCap(document: QueueDocument, extra: number, maxPending: number): void {
  const count = document.entries.filter((entry) => entry.status === 'pending').length
  if (count + extra > maxPending) throw new Error(`queue pending cap is ${maxPending}`)
}

export function validateBatch(document: QueueDocument, entries: QueueInsert[]): void {
  if (entries.length === 0) throw new Error('queue batch is empty')
  const groups = new Map<string, QueueInsert[]>()
  for (const entry of entries) {
    if (!entry.comparison) continue
    const group = groups.get(entry.comparison.groupId) ?? []
    group.push(entry)
    groups.set(entry.comparison.groupId, group)
  }
  for (const [groupId, group] of groups) {
    if (
      groupId.length === 0 ||
      groupId.length > 128 ||
      group.length !== 2 ||
      new Set(group.map((entry) => entry.comparison?.blindLabel)).size !== 2 ||
      group.some((entry) => entry.comparison?.revealed) ||
      document.entries.some((entry) => entry.comparison?.groupId === groupId)
    ) {
      throw new Error('comparison batch is invalid')
    }
  }
  const unrevealed = new Set(
    document.entries.flatMap((entry) =>
      entry.comparison && !entry.comparison.revealed ? [entry.comparison.groupId] : []
    )
  )
  if (unrevealed.size + groups.size > MAX_UNREVEALED_COMPARISONS) {
    throw new Error('reveal an older comparison before adding another')
  }
}

export function pruneHistory(document: QueueDocument, maxHistory: number): void {
  while (document.entries.filter(isTerminal).length > maxHistory) {
    const candidate = document.entries.find((entry) => {
      if (!isTerminal(entry)) return false
      if (!entry.comparison) return true
      if (!entry.comparison.revealed) return false
      return document.entries
        .filter((peer) => peer.comparison?.groupId === entry.comparison?.groupId)
        .every(isTerminal)
    })
    if (!candidate) return
    const groupId = candidate.comparison?.groupId
    document.entries = document.entries.filter((entry) =>
      groupId ? entry.comparison?.groupId !== groupId : entry.id !== candidate.id
    )
  }
}

export function keepWhenClearing(entry: QueueEntry, entries: QueueEntry[]): boolean {
  if (['pending', 'running'].includes(entry.status)) return true
  if (!entry.comparison) return false
  if (!entry.comparison.revealed) return true
  return entries.some(
    (peer) =>
      peer.comparison?.groupId === entry.comparison?.groupId &&
      ['pending', 'running'].includes(peer.status)
  )
}

export function abandonComparison(document: QueueDocument, groupId: string, at: number): void {
  const group = document.entries.filter((entry) => entry.comparison?.groupId === groupId)
  if (group.length !== 2) throw new Error('comparison group is unavailable')
  if (group.some((entry) => entry.status === 'running')) {
    throw new Error('stop the running candidate before abandoning its comparison')
  }
  const pending = group.filter((entry) => entry.status === 'pending')
  if (pending.length === 0) throw new Error('comparison has no unfinished candidate')
  for (const entry of pending) {
    entry.status = 'cancelled'
    entry.updatedAt = at
    entry.finishedAt = at
    entry.error = {
      code: 'comparison_abandoned',
      message: 'Comparison candidate was abandoned before generation.'
    }
  }
  for (const entry of group) delete entry.comparison?.internalBlueprint
}
