// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LibraryTrack } from '../../../shared/contract'

export const TRACK_SORT_ORDERS = ['newest', 'oldest', 'name', 'bpm'] as const
export type TrackSortOrder = (typeof TRACK_SORT_ORDERS)[number]

// Renderer-local ordering over the already-loaded list. BPM sort is ascending
// and keeps tracks without a detected tempo at the end in their newest-first
// order, so an unanalyzed library never looks reshuffled.
export function sortTracks(tracks: LibraryTrack[], order: TrackSortOrder): LibraryTrack[] {
  if (order === 'newest') return tracks
  const sorted = [...tracks]
  if (order === 'oldest') return sorted.reverse()
  if (order === 'name') {
    return sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }
  const withBpm = sorted.filter((track) => typeof track.detected?.bpm === 'number')
  const withoutBpm = sorted.filter((track) => typeof track.detected?.bpm !== 'number')
  withBpm.sort((a, b) => (a.detected?.bpm ?? 0) - (b.detected?.bpm ?? 0))
  return [...withBpm, ...withoutBpm]
}
