// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LibraryTrack } from '../../../shared/contract'

export interface TargetMusicalMetadata {
  bpm?: number
  key?: string
}

// Generation controls are targets, never detector output. Keep this helper
// explicit so Library/player badges cannot accidentally relabel them as
// measured BPM or key when processor results arrive later.
export function targetMusicalMetadata(track: LibraryTrack | null): TargetMusicalMetadata {
  const bpm = track?.config?.bpm
  const keyscale = track?.config?.keyscale
  const key = typeof keyscale === 'string' ? keyscale.trim() : ''
  return {
    ...(typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? { bpm } : {}),
    ...(key ? { key } : {})
  }
}

export interface DetectedMusicalMetadata {
  bpm?: string
  key?: string
}

// Detected badges format measured processor results only. The trailing .0 is
// dropped for round tempos so a badge reads "128 BPM", not "128.0 BPM".
export function detectedMusicalMetadata(track: LibraryTrack | null): DetectedMusicalMetadata {
  const detected = track?.detected
  if (!detected) return {}
  const bpm =
    typeof detected.bpm === 'number' && Number.isFinite(detected.bpm)
      ? `${Number.isInteger(Math.round(detected.bpm * 10) / 10) ? Math.round(detected.bpm) : detected.bpm.toFixed(1)} BPM`
      : undefined
  const key =
    detected.keyPitchClass && detected.keyMode
      ? `${detected.keyPitchClass} ${detected.keyMode}`
      : undefined
  return { ...(bpm ? { bpm } : {}), ...(key ? { key } : {}) }
}

// Row badge assembly kept beside the formatter so TrackRow stays lean.
export function detectedBadges(track: LibraryTrack | null): { text: string; title: string }[] {
  const detected = detectedMusicalMetadata(track)
  return [
    ...(detected.bpm
      ? [{ text: detected.bpm, title: 'Detected tempo (default BPM provider)' }]
      : []),
    ...(detected.key ? [{ text: detected.key, title: 'Detected key (default key provider)' }] : [])
  ]
}
