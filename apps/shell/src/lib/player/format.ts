// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LibraryTrack } from '../../../shared/contract'
import type { JobState } from '@iblis/plugin-sdk'

const generationLabels: Record<JobState['status'], string> = {
  queued: 'Queued',
  lm: 'Composing',
  synth: 'Rendering',
  finishing: 'Finishing',
  done: 'Done',
  error: 'Failed'
}

export function formatGeneration(status: JobState['status']): string {
  return generationLabels[status]
}

export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '–:––'
  }
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function formatAudio(track: LibraryTrack): string {
  const facts = track.audio
  if (!facts) return track.format.toUpperCase()
  const channels =
    facts.channels === 1 ? 'mono' : facts.channels === 2 ? 'stereo' : `${facts.channels} ch`
  const codec = facts.codec === 'ieee-float' ? 'float' : 'PCM'
  const sampleRate =
    facts.sampleRateHz % 1000 === 0
      ? `${facts.sampleRateHz / 1000} kHz`
      : `${(facts.sampleRateHz / 1000).toFixed(1)} kHz`
  return `${track.format.toUpperCase()} · ${sampleRate} · ${channels} · ${facts.bitsPerSample}-bit ${codec}`
}
