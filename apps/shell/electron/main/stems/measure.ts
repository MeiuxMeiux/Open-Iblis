// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Pure per-stem measurement: strict WAV facts, display peaks, levels, and
// BPM/key measured on the stem itself with the first-party Iblis DSP. Drums
// carry tempo; pitched stems carry key. Near-silent stems are measured for
// level only, because a detector on silence reports noise as a fact.

import type { StemRole } from '@iblis/plugin-sdk'
import type { StemMeasuredFacts, StemPeaks } from '../../../shared/stems'
import { analyzeWav } from '../media/analysis'
import { decodeWavMonoBytes } from '../processors/builtin/decode'
import { detectBpm, detectKey } from '../processors/builtin/dsp'

const STEM_PEAK_BUCKETS = 480
const SILENT_RMS_DB = -55

export interface StemMeasurement {
  role: StemRole
  sampleRateHz: number
  channels: number
  frames: number
  durationSec: number
  peakDb: number
  rmsDb: number
  silent: boolean
  peaks: StemPeaks
  measured: StemMeasuredFacts
}

const KEY_ROLES: ReadonlySet<StemRole> = new Set([
  'stem.bass',
  'stem.other',
  'stem.vocals',
  'stem.guitar',
  'stem.piano'
])

function db(amplitude: number): number {
  if (!(amplitude > 1e-6)) return -120
  return Math.max(-120, Math.round(20 * Math.log10(amplitude) * 10) / 10)
}

function round3(values: number[]): number[] {
  return values.map((v) => Math.round(v * 1000) / 1000)
}

export function measureStem(role: StemRole, bytes: Uint8Array): StemMeasurement {
  const analysis = analyzeWav(bytes, STEM_PEAK_BUCKETS)
  const rmsDb = db(analysis.rmsAmplitude)
  const silent = rmsDb < SILENT_RMS_DB
  const measured: StemMeasuredFacts = {}
  if (!silent && (role === 'stem.drums' || KEY_ROLES.has(role))) {
    const audio = decodeWavMonoBytes(bytes)
    if (role === 'stem.drums') {
      const bpm = detectBpm(audio.samples, audio.sampleRate)
      measured.bpm = { value: bpm.bpm, confidence: bpm.confidence }
    } else {
      const key = detectKey(audio.samples, audio.sampleRate)
      measured.key = { pitchClass: key.pitchClass, mode: key.mode, confidence: key.confidence }
    }
  }
  return {
    role,
    sampleRateHz: analysis.source.sampleRateHz,
    channels: analysis.source.channels,
    frames: analysis.source.frames,
    durationSec: analysis.source.durationSec,
    peakDb: db(analysis.peakAmplitude),
    rmsDb,
    silent,
    peaks: { min: round3(analysis.peaks.min), max: round3(analysis.peaks.max) },
    measured
  }
}
