// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// First-party BPM/key estimation for the built-in "Iblis DSP" provider.
// Tempo: spectral-flux onset envelope -> autocorrelation with harmonic
// support (Percival/Ellis family). Key: octave-folded chromagram correlated
// against Krumhansl-Schmuckler profiles. Confidence values are the raw
// normalized scores of those measures, never invented calibration.

import type { BpmDetectionValueV1, KeyDetectionValueV1 } from '@iblis/plugin-sdk'
import { CANONICAL_KEY_PITCH_CLASSES } from '@iblis/plugin-sdk'

const MIN_BPM = 50
const MAX_BPM = 210

// Indexed read for loops whose bounds are established by construction; a miss
// is a programming error, so it throws rather than yielding NaN.
function at<T>(values: ArrayLike<T>, index: number): T {
  const value = values[index]
  if (value === undefined) throw new RangeError(`index ${index} is out of range`)
  return value
}

// In-place iterative radix-2 FFT; length must be a power of two.
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [at(re, j), at(re, i)]
      ;[im[i], im[j]] = [at(im, j), at(im, i)]
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let start = 0; start < n; start += length) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < length / 2; k++) {
        const evenRe = at(re, start + k)
        const evenIm = at(im, start + k)
        const oddRe = at(re, start + k + length / 2)
        const oddIm = at(im, start + k + length / 2)
        const tRe = oddRe * curRe - oddIm * curIm
        const tIm = oddRe * curIm + oddIm * curRe
        re[start + k] = evenRe + tRe
        im[start + k] = evenIm + tIm
        re[start + k + length / 2] = evenRe - tRe
        im[start + k + length / 2] = evenIm - tIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

function hannWindow(size: number): Float64Array {
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  return window
}

function magnitudes(
  samples: Float32Array,
  offset: number,
  window: Float64Array,
  re: Float64Array,
  im: Float64Array
): Float64Array {
  const size = window.length
  for (let i = 0; i < size; i++) {
    re[i] = (samples[offset + i] ?? 0) * at(window, i)
    im[i] = 0
  }
  fft(re, im)
  const bins = new Float64Array(size / 2)
  for (let i = 0; i < bins.length; i++) bins[i] = Math.hypot(at(re, i), at(im, i))
  return bins
}

// Half-wave-rectified spectral flux with a moving-mean subtraction so quiet
// and loud passages contribute comparable onset peaks.
function onsetEnvelope(samples: Float32Array, frame: number, hop: number): Float64Array {
  const window = hannWindow(frame)
  const re = new Float64Array(frame)
  const im = new Float64Array(frame)
  const count = Math.max(0, Math.floor((samples.length - frame) / hop))
  const flux = new Float64Array(count)
  let previous: Float64Array | null = null
  for (let i = 0; i < count; i++) {
    const bins = magnitudes(samples, i * hop, window, re, im)
    if (previous) {
      let sum = 0
      for (let k = 0; k < bins.length; k++) {
        const diff = at(bins, k) - at(previous, k)
        if (diff > 0) sum += diff
      }
      flux[i] = sum
    }
    previous = bins
  }
  const mean = new Float64Array(count)
  const span = 16
  for (let i = 0; i < count; i++) {
    let sum = 0
    let n = 0
    for (let k = Math.max(0, i - span); k < Math.min(count, i + span + 1); k++, n++)
      sum += at(flux, k)
    mean[i] = n ? sum / n : 0
  }
  for (let i = 0; i < count; i++) flux[i] = Math.max(0, at(flux, i) - at(mean, i))
  return flux
}

function autocorrelation(envelope: Float64Array, maxLag: number): Float64Array {
  const r = new Float64Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i + lag < envelope.length; i++) sum += at(envelope, i) * at(envelope, i + lag)
    r[lag] = sum
  }
  return r
}

export function detectBpm(samples: Float32Array, sampleRate: number): BpmDetectionValueV1 {
  const frame = 1024
  const hop = 512
  const envelope = onsetEnvelope(samples, frame, hop)
  const fps = sampleRate / hop
  const minLag = Math.floor((60 * fps) / MAX_BPM)
  const maxLag = Math.ceil((60 * fps) / MIN_BPM)
  if (envelope.length < maxLag * 3 + 2) throw new Error('audio is too short for tempo analysis')
  const r = autocorrelation(envelope, maxLag * 3 + 1)
  const r0 = at(r, 0)
  if (r0 <= 0) throw new Error('audio has no measurable onsets')

  // Score each candidate lag with support from its 2x and 3x harmonics so the
  // beat period wins over bar or half-beat periods.
  const scores = new Float64Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    scores[lag] = (at(r, lag) + 0.5 * at(r, lag * 2) + 0.25 * at(r, lag * 3)) / (r0 * 1.75)
  }
  const peaks: { lag: number; score: number }[] = []
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (at(scores, lag) > at(scores, lag - 1) && at(scores, lag) >= at(scores, lag + 1)) {
      peaks.push({ lag, score: at(scores, lag) })
    }
  }
  if (peaks.length === 0) throw new Error('audio has no stable tempo')
  peaks.sort((a, b) => b.score - a.score)
  const best = at(peaks, 0)

  // Parabolic interpolation around the winning lag for sub-frame precision.
  const y0 = at(scores, best.lag - 1)
  const y1 = at(scores, best.lag)
  const y2 = at(scores, best.lag + 1)
  const denominator = y0 - 2 * y1 + y2
  const shift =
    denominator !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denominator)) : 0
  const bpm = (60 * fps) / (best.lag + shift)

  const alternatives = peaks
    .slice(1, 4)
    .filter((peak) => Math.abs((60 * fps) / peak.lag - bpm) > 1)
    .map((peak) => ({
      bpm: (60 * fps) / peak.lag,
      confidence: clamp01(peak.score)
    }))
  return {
    schemaVersion: 1,
    bpm,
    confidence: clamp01(best.score),
    alternatives: alternatives.slice(0, 8)
  }
}

// Krumhansl-Kessler key profiles (tonic first).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length
  const meanA = a.reduce((sum, value) => sum + value, 0) / n
  const meanB = b.reduce((sum, value) => sum + value, 0) / n
  let num = 0
  let denA = 0
  let denB = 0
  for (let i = 0; i < n; i++) {
    const da = at(a, i) - meanA
    const db = at(b, i) - meanB
    num += da * db
    denA += da * da
    denB += db * db
  }
  const denominator = Math.sqrt(denA * denB)
  return denominator > 0 ? num / denominator : 0
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function chromagram(samples: Float32Array, sampleRate: number): number[] {
  const frame = 8192
  const hop = 4096
  const window = hannWindow(frame)
  const re = new Float64Array(frame)
  const im = new Float64Array(frame)
  const chroma = new Array<number>(12).fill(0)
  const count = Math.max(0, Math.floor((samples.length - frame) / hop))
  if (count === 0) throw new Error('audio is too short for key analysis')
  const minHz = 55
  const maxHz = 5000
  for (let i = 0; i < count; i++) {
    const bins = magnitudes(samples, i * hop, window, re, im)
    for (let bin = 1; bin < bins.length; bin++) {
      const hz = (bin * sampleRate) / frame
      if (hz < minHz) continue
      if (hz > maxHz) break
      const midi = 69 + 12 * Math.log2(hz / 440)
      const pitchClass = ((Math.round(midi) % 12) + 12) % 12
      chroma[pitchClass] = at(chroma, pitchClass) + at(bins, bin)
    }
  }
  return chroma
}

export function detectKey(samples: Float32Array, sampleRate: number): KeyDetectionValueV1 {
  const chroma = chromagram(samples, sampleRate)
  if (chroma.every((value) => value === 0)) throw new Error('audio has no tonal content')
  // Pitch class 0 in the chroma is C (midi % 12 === 0).
  const candidates: { pitchClass: number; mode: 'major' | 'minor'; score: number }[] = []
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = chroma.map((_, index) => at(chroma, (index + tonic) % 12))
    candidates.push({
      pitchClass: tonic,
      mode: 'major',
      score: correlation(rotated, MAJOR_PROFILE)
    })
    candidates.push({
      pitchClass: tonic,
      mode: 'minor',
      score: correlation(rotated, MINOR_PROFILE)
    })
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = at(candidates, 0)
  return {
    schemaVersion: 1,
    pitchClass: at(CANONICAL_KEY_PITCH_CLASSES, best.pitchClass),
    mode: best.mode,
    confidence: clamp01(best.score),
    alternatives: candidates.slice(1, 4).map((candidate) => ({
      pitchClass: at(CANONICAL_KEY_PITCH_CLASSES, candidate.pitchClass),
      mode: candidate.mode,
      confidence: clamp01(candidate.score)
    }))
  }
}
