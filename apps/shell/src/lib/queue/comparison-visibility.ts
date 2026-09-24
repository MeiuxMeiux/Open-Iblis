// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LibraryTrack } from '../../../shared/contract'
import type { QueueComparison, QueueEntry } from '../../../shared/generation-queue'

function sameConfig(left: LibraryTrack['config'], right: QueueEntry['request']['config']): boolean {
  const a = left ?? {}
  const b = right ?? {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => a[key as keyof typeof a] === b[key as keyof typeof b])
}

function requestMatches(track: LibraryTrack, entry: QueueEntry): boolean {
  const request = entry.request
  return (
    track.prompt === request.prompt &&
    track.preset === request.preset &&
    track.seed === request.seed &&
    track.requestedDurationSec === request.durationSec &&
    (track.lyrics ?? '') === (request.lyrics ?? '') &&
    sameConfig(track.config, request.config)
  )
}

// writeWav creates the Library row during the queue's finishing phase, before
// JobState receives result.trackId. The fallback is limited to that one live
// interval and a newly created row so an older exact remix cannot inherit a
// randomized blind label.
export function comparisonForTrack(
  track: LibraryTrack,
  entries: QueueEntry[]
): QueueComparison | undefined {
  const direct = entries.find(
    (entry) =>
      (track.generationJobId !== undefined && entry.jobId === track.generationJobId) ||
      entry.job?.result?.trackId === track.id
  )?.comparison
  if (direct) return direct
  return entries.find(
    (entry) =>
      entry.status === 'running' &&
      entry.startedAt !== undefined &&
      track.createdAt >= entry.startedAt &&
      entry.comparison &&
      !entry.comparison.revealed &&
      requestMatches(track, entry)
  )?.comparison
}
