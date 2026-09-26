// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { StemRole } from '@iblis/plugin-sdk'
import type { StemFileView, StemJobView, StemSetView } from '../../../shared/stems'
import { STEM_LABELS, STEM_STAGE_LABELS } from '../../../shared/stems'
import type { IconName } from '../ui/icons'

export const STEM_ICONS: Record<StemRole, IconName> = {
  'stem.vocals': 'mic',
  'stem.drums': 'drum',
  'stem.bass': 'bass',
  'stem.other': 'layers',
  'stem.guitar': 'guitar',
  'stem.piano': 'piano'
}

// CSS custom property of the skin token for a lane: stem.vocals -> --stem-vocals.
export function stemColorVar(role: StemRole): string {
  return `var(--${role.replace('.', '-')})`
}

export function stemLabel(role: StemRole): string {
  return STEM_LABELS[role]
}

function bpmText(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded.toFixed(1)} BPM`
}

function confidenceText(value: number | null): string {
  return value === null ? 'confidence not reported' : `${Math.round(value * 100)}% confidence`
}

export interface StemBadge {
  text: string
  title: string
  icon: IconName
}

// Measured on this stem by the built-in Iblis DSP; the titles say so, so a
// stem badge is never mistaken for the track's own detected or requested value.
export function stemBadges(stem: StemFileView): StemBadge[] {
  const badges: StemBadge[] = []
  if (stem.measured.bpm) {
    badges.push({
      text: bpmText(stem.measured.bpm.value),
      title: `Tempo measured on the ${stemLabel(stem.role).toLowerCase()} stem, ${confidenceText(stem.measured.bpm.confidence)}`,
      icon: 'metronome'
    })
  }
  if (stem.measured.key) {
    const { pitchClass, mode, confidence } = stem.measured.key
    badges.push({
      text: `${pitchClass} ${mode}`,
      title: `Key measured on the ${stemLabel(stem.role).toLowerCase()} stem, ${confidenceText(confidence)}`,
      icon: 'key'
    })
  }
  return badges
}

// Set-level summary: tempo from drums, key from the most confident pitched
// stem. Returned separately so the header can label its source.
export function setSummary(set: StemSetView): { bpm?: StemBadge; key?: StemBadge } {
  const drums = set.stems.find((s) => s.role === 'stem.drums' && s.measured.bpm)
  const pitched = set.stems
    .filter((s) => s.measured.key)
    .sort((a, b) => (b.measured.key?.confidence ?? 0) - (a.measured.key?.confidence ?? 0))[0]
  const bpm = drums?.measured.bpm
  const key = pitched?.measured.key
  const summary: { bpm?: StemBadge; key?: StemBadge } = {}
  if (bpm) {
    summary.bpm = {
      text: bpmText(bpm.value),
      title: 'Tempo measured on the drums stem',
      icon: 'metronome'
    }
  }
  if (pitched && key) {
    summary.key = {
      text: `${key.pitchClass} ${key.mode}`,
      title: `Key measured on the ${stemLabel(pitched.role).toLowerCase()} stem`,
      icon: 'key'
    }
  }
  return summary
}

export function residualQuality(db: number): {
  text: string
  tone: 'success' | 'warning' | 'danger'
} {
  if (db <= -25) return { text: 'clean re-sum', tone: 'success' }
  if (db <= -15) return { text: 'some bleed', tone: 'warning' }
  return { text: 'heavy bleed', tone: 'danger' }
}

export function durationText(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function backendText(backend: string | undefined): string {
  if (backend === 'gpu') return 'GPU'
  if (backend === 'cpu') return 'CPU'
  return 'Auto'
}

export function stageText(job: StemJobView): string {
  return STEM_STAGE_LABELS[job.stage ?? job.status] ?? 'Working'
}
