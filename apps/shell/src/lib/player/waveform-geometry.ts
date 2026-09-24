// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AudioAnalysis, AudibleBounds, PeakEnvelope } from '../../../shared/contract'
import type { WaveformAnalysisState } from '../waveform-analysis.svelte'

export interface WaveformGeometry {
  width: number
  height: number
  columns: number
  path: string
}

export type WaveformMode = 'peaks' | 'mirrored' | 'timeline'

export interface SilenceRegions {
  leadingRatio: number
  trailingRatio: number
}

function coordinate(value: number): string {
  return String(Number(value.toFixed(2)) || 0)
}

export function buildWaveformGeometry(
  peaks: PeakEnvelope,
  measuredWidth: number,
  measuredHeight: number,
  mode: WaveformMode = 'peaks',
  padding = 2
): WaveformGeometry | null {
  if (mode === 'timeline') return null
  const width = Math.round(measuredWidth)
  const height = Math.round(measuredHeight)
  const buckets = peaks.min.length
  if (
    !Number.isFinite(measuredWidth) ||
    !Number.isFinite(measuredHeight) ||
    !Number.isFinite(padding) ||
    width <= 0 ||
    height <= 0 ||
    buckets <= 0 ||
    buckets !== peaks.max.length ||
    padding < 0 ||
    padding * 2 >= height
  ) {
    return null
  }
  const columns = Math.min(width, buckets)
  const drawable = height - padding * 2
  const segments: string[] = []
  for (let column = 0; column < columns; column++) {
    const start = Math.floor((column * buckets) / columns)
    const end = Math.floor(((column + 1) * buckets) / columns)
    let low = 1
    let high = -1
    for (let bucket = start; bucket < end; bucket++) {
      low = Math.min(low, peaks.min[bucket] ?? low)
      high = Math.max(high, peaks.max[bucket] ?? high)
    }
    if (mode === 'mirrored') {
      const magnitude = Math.max(Math.abs(low), Math.abs(high))
      low = -magnitude
      high = magnitude
    }
    const x = ((column + 0.5) * width) / columns
    const top = padding + ((1 - high) * drawable) / 2
    const bottom = padding + ((1 - low) * drawable) / 2
    segments.push(`M${coordinate(x)},${coordinate(top)}V${coordinate(bottom)}`)
  }
  return { width, height, columns, path: segments.join('') }
}

export function silenceRegions(bounds: AudibleBounds, frames: number): SilenceRegions {
  if (!Number.isInteger(frames) || frames <= 0 || bounds.classification === 'indeterminate') {
    return { leadingRatio: 0, trailingRatio: 0 }
  }
  if (bounds.classification === 'silent') return { leadingRatio: 1, trailingRatio: 0 }
  return {
    leadingRatio: Math.min(1, Math.max(0, (bounds.startFrame ?? 0) / frames)),
    trailingRatio: Math.min(
      1,
      Math.max(0, (frames - (bounds.endFrameExclusive ?? frames)) / frames)
    )
  }
}

export function analysisMatchesBrowser(
  analysis: AudioAnalysis,
  browserDurationSec: number | null
): boolean {
  if (browserDurationSec === null || !Number.isFinite(browserDurationSec)) return false
  const tolerance = 1 / analysis.source.sampleRateHz + 1e-6
  return Math.abs(browserDurationSec - analysis.source.durationSec) <= tolerance
}

export interface WaveformAnalysisDisplay {
  analysis: AudioAnalysis | null
  label: string | null
}

export function waveformAnalysisDisplay(
  state: WaveformAnalysisState,
  trackId: string | null,
  browserDurationSec: number | null
): WaveformAnalysisDisplay {
  if (!trackId) return { analysis: null, label: null }
  if (state.phase === 'ready' && state.trackId === trackId) {
    if (browserDurationSec === null || !Number.isFinite(browserDurationSec)) {
      return { analysis: null, label: 'Preparing waveform' }
    }
    return analysisMatchesBrowser(state.analysis, browserDurationSec)
      ? { analysis: state.analysis, label: null }
      : { analysis: null, label: 'Waveform unavailable' }
  }
  if (state.phase === 'error' && state.trackId === trackId) {
    return { analysis: null, label: 'Waveform unavailable' }
  }
  return { analysis: null, label: 'Analyzing waveform' }
}
