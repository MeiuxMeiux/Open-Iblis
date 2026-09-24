// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { AudioAnalysis, AudibleBounds, PeakEnvelope } from '../shared/contract'
import {
  analysisMatchesBrowser,
  buildWaveformGeometry,
  silenceRegions,
  waveformAnalysisDisplay
} from '../src/lib/player/waveform-geometry'
import type { WaveformAnalysisState } from '../src/lib/waveform-analysis.svelte'

function peaks(min: number[], max: number[]): PeakEnvelope {
  return { frames: 100, sampleRateHz: 1000, durationSec: 0.1, min, max }
}

function bounds(patch: Partial<AudibleBounds> = {}): AudibleBounds {
  return {
    classification: 'audible',
    algorithm: 'sustained-channel-rms-v1',
    openDbfs: -45,
    closeDbfs: -51,
    windowFrames: 10,
    openWindows: 5,
    closeWindows: 15,
    attackPadMs: 50,
    reverbPadMs: 500,
    startFrame: 20,
    endFrameExclusive: 75,
    leadingSilenceSec: 0.02,
    trailingSilenceSec: 0.025,
    audibleDurationSec: 0.055,
    ...patch
  }
}

describe('waveform geometry', () => {
  it('aggregates exact source intervals and preserves extrema', () => {
    const geometry = buildWaveformGeometry(
      peaks([-1, -0.5, 0, 0.25], [-0.5, 0, 0.5, 1]),
      2,
      10,
      'peaks',
      0
    )
    expect(geometry).toEqual({
      width: 2,
      height: 10,
      columns: 2,
      path: 'M0.5,5V10M1.5,0V5'
    })
  })

  it('defaults to signed peaks and preserves DC offset', () => {
    const value = peaks([0.5], [0.75])
    expect(buildWaveformGeometry(value, 10, 10)).toEqual(
      buildWaveformGeometry(value, 10, 10, 'peaks')
    )
    expect(buildWaveformGeometry(value, 10, 10, 'peaks', 0)?.path).toBe('M5,1.25V2.5')
  })

  it('mirrors the exact maximum magnitude after viewport aggregation', () => {
    const geometry = buildWaveformGeometry(
      peaks([-0.2, -0.9, 0.1, 0.3], [0.8, 0.4, 0.5, 1]),
      2,
      10,
      'mirrored',
      0
    )
    expect(geometry).toEqual({
      width: 2,
      height: 10,
      columns: 2,
      path: 'M0.5,0.5V9.5M1.5,0V10'
    })
  })

  it('keeps mirrored geometry symmetric for an offset source bucket', () => {
    expect(buildWaveformGeometry(peaks([0.5], [0.75]), 10, 10, 'mirrored', 0)?.path).toBe(
      'M5,1.25V8.75'
    )
  })

  it('returns no amplitude geometry for the neutral timeline', () => {
    expect(buildWaveformGeometry(peaks([-1], [1]), 10, 10, 'timeline', 0)).toBeNull()
  })

  it('never duplicates buckets when the viewport is wider than the envelope', () => {
    const geometry = buildWaveformGeometry(peaks([-1, -0.5], [0.5, 1]), 100, 20, 'peaks', 2)
    expect(geometry?.columns).toBe(2)
    expect(geometry?.path.match(/M/g)).toHaveLength(2)
  })

  it('maps DC offset directly and skips hidden or invalid dimensions', () => {
    expect(buildWaveformGeometry(peaks([-1], [1]), 0, 10)).toBeNull()
    expect(buildWaveformGeometry(peaks([-1], [1]), 10, 0)).toBeNull()
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(buildWaveformGeometry(peaks([-1], [1]), invalid, 10)).toBeNull()
      expect(buildWaveformGeometry(peaks([-1], [1]), 10, invalid)).toBeNull()
      expect(buildWaveformGeometry(peaks([-1], [1]), 10, 10, 'peaks', invalid)).toBeNull()
    }
  })

  it('derives silence shading only from analyzed frame bounds', () => {
    expect(silenceRegions(bounds(), 100)).toEqual({ leadingRatio: 0.2, trailingRatio: 0.25 })
    expect(silenceRegions(bounds({ classification: 'silent' }), 100)).toEqual({
      leadingRatio: 1,
      trailingRatio: 0
    })
    expect(silenceRegions(bounds({ classification: 'indeterminate' }), 100)).toEqual({
      leadingRatio: 0,
      trailingRatio: 0
    })
  })

  it('rejects peak alignment when browser duration differs materially', () => {
    const analysis = {
      source: { durationSec: 1, sampleRateHz: 1000 }
    } as AudioAnalysis
    expect(analysisMatchesBrowser(analysis, 1.0005)).toBe(true)
    expect(analysisMatchesBrowser(analysis, 1.005)).toBe(false)
    expect(analysisMatchesBrowser(analysis, null)).toBe(false)
  })

  it('keeps ready analysis pending until browser metadata can validate it', () => {
    const value = {
      source: { durationSec: 1, sampleRateHz: 1000 }
    } as AudioAnalysis
    const state: WaveformAnalysisState = { phase: 'ready', trackId: 'a', analysis: value }

    expect(waveformAnalysisDisplay(state, 'a', null)).toEqual({
      analysis: null,
      label: 'Preparing waveform'
    })
    expect(waveformAnalysisDisplay(state, 'a', Number.NaN)).toEqual({
      analysis: null,
      label: 'Preparing waveform'
    })
    expect(waveformAnalysisDisplay(state, 'a', 1)).toEqual({ analysis: value, label: null })
    expect(waveformAnalysisDisplay(state, 'a', 2)).toEqual({
      analysis: null,
      label: 'Waveform unavailable'
    })
    expect(waveformAnalysisDisplay(state, 'b', 1)).toEqual({
      analysis: null,
      label: 'Analyzing waveform'
    })
  })
})
