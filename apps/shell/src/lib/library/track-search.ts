// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LibraryTrack } from '../../../shared/contract'

// Search stays renderer-local: it filters metadata already loaded for the
// Library view and never exposes a path or reaches across the IPC boundary.
export function matchesTrackQuery(
  track: Pick<LibraryTrack, 'name' | 'prompt' | 'tags' | 'detected'>,
  query: string
): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  const detected = track.detected
  const detectedText = [
    ...(typeof detected?.bpm === 'number' ? [`${Math.round(detected.bpm)} bpm`] : []),
    ...(detected?.keyPitchClass && detected.keyMode
      ? [`${detected.keyPitchClass} ${detected.keyMode}`]
      : [])
  ]
  return [track.name, track.prompt, ...track.tags, ...detectedText].some((value) =>
    value.toLocaleLowerCase().includes(needle)
  )
}
