// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AudioAnalysis, AudibleBounds } from '../../../shared/contract'
import { parseWav, type WavMetadata } from './wav'

export const MAX_PEAK_BUCKETS = 4096
export const MAX_ANALYSIS_BYTES = 512 * 1024 * 1024
const MAX_ANALYSIS_CHANNELS = 32
const WINDOW_MS = 10
const OPEN_DBFS = -45
const CLOSE_DBFS = -51
const OPEN_WINDOWS = 5
const CLOSE_WINDOWS = 15
const ATTACK_PAD_MS = 50
const REVERB_PAD_MS = 500

class AudioAnalysisError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AudioAnalysisError'
  }
}

function fail(code: string, message: string): never {
  throw new AudioAnalysisError(code, message)
}

function sampleAt(view: DataView, offset: number, facts: WavMetadata): number {
  if (facts.codec === 'ieee-float') {
    return facts.bitsPerSample === 32
      ? view.getFloat32(offset, true)
      : view.getFloat64(offset, true)
  }
  switch (facts.bitsPerSample) {
    case 8:
      return (view.getUint8(offset) - 128) / 128
    case 16:
      return view.getInt16(offset, true) / 32768
    case 24: {
      const raw =
        view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
      return (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608
    }
    case 32:
      return view.getInt32(offset, true) / 2147483648
    default:
      return fail('unsupported_depth', `cannot decode ${facts.bitsPerSample}-bit samples`)
  }
}

interface ScaledSquares {
  scale: number
  sum: number
  count: number
}

function addSquare(acc: ScaledSquares, value: number): void {
  const magnitude = Math.abs(value)
  acc.count++
  if (magnitude === 0) return
  if (acc.scale < magnitude) {
    const ratio = acc.scale / magnitude
    acc.sum = 1 + acc.sum * ratio * ratio
    acc.scale = magnitude
  } else {
    const ratio = magnitude / acc.scale
    acc.sum += ratio * ratio
  }
}

function rms(acc: ScaledSquares): number {
  return acc.count === 0 || acc.scale === 0 ? 0 : acc.scale * Math.sqrt(acc.sum / acc.count)
}

interface GateScan {
  detectedStart: number | undefined
  detectedEnd: number | undefined
  active: boolean
  reachedOpen: boolean
}

// Hysteresis gate over per-window levels: OPEN_WINDOWS loud windows open it,
// CLOSE_WINDOWS quiet ones close it again.
function scanGate(levels: number[], frames: number, windowFrames: number): GateScan {
  const open = 10 ** (OPEN_DBFS / 20)
  const close = 10 ** (CLOSE_DBFS / 20)
  let openRun = 0
  let closeRun = 0
  let active = false
  let detectedStart: number | undefined
  let detectedEnd: number | undefined
  let reachedOpen = false

  for (let index = 0; index < levels.length; index++) {
    const level = levels[index] ?? 0
    if (level >= open) reachedOpen = true
    if (!active) {
      openRun = level >= open ? openRun + 1 : 0
      if (openRun < OPEN_WINDOWS) continue
      const firstWindow = index - OPEN_WINDOWS + 1
      detectedStart ??= firstWindow * windowFrames
      detectedEnd = Math.min(frames, (index + 1) * windowFrames)
      active = true
      closeRun = 0
      continue
    }

    if (level >= close) {
      closeRun = 0
      detectedEnd = Math.min(frames, (index + 1) * windowFrames)
      continue
    }
    closeRun++
    if (closeRun < CLOSE_WINDOWS) continue
    detectedEnd = Math.min(frames, (index - CLOSE_WINDOWS + 1) * windowFrames)
    active = false
    openRun = 0
    closeRun = 0
  }
  return { detectedStart, detectedEnd, active, reachedOpen }
}

function audibleBounds(levels: number[], facts: WavMetadata, windowFrames: number): AudibleBounds {
  const scan = scanGate(levels, facts.frames, windowFrames)
  const common = {
    algorithm: 'sustained-channel-rms-v1' as const,
    openDbfs: OPEN_DBFS,
    closeDbfs: CLOSE_DBFS,
    windowFrames,
    openWindows: OPEN_WINDOWS,
    closeWindows: CLOSE_WINDOWS,
    attackPadMs: ATTACK_PAD_MS,
    reverbPadMs: REVERB_PAD_MS
  }
  const { detectedStart } = scan
  let { detectedEnd } = scan
  if (detectedStart === undefined || detectedEnd === undefined) {
    if (!scan.reachedOpen) {
      return {
        ...common,
        classification: 'silent',
        leadingSilenceSec: facts.durationSec,
        trailingSilenceSec: facts.durationSec
      }
    }
    return {
      ...common,
      classification: 'indeterminate',
      startFrame: 0,
      endFrameExclusive: facts.frames,
      leadingSilenceSec: 0,
      trailingSilenceSec: 0,
      audibleDurationSec: facts.durationSec
    }
  }

  if (scan.active) detectedEnd = facts.frames
  const attackFrames = Math.round((facts.sampleRateHz * ATTACK_PAD_MS) / 1000)
  const reverbFrames = Math.round((facts.sampleRateHz * REVERB_PAD_MS) / 1000)
  const startFrame = Math.max(0, detectedStart - attackFrames)
  const endFrameExclusive = Math.min(facts.frames, detectedEnd + reverbFrames)
  return {
    ...common,
    classification: 'audible',
    detectedStartFrame: detectedStart,
    detectedEndFrameExclusive: detectedEnd,
    startFrame,
    endFrameExclusive,
    leadingSilenceSec: startFrame / facts.sampleRateHz,
    trailingSilenceSec: (facts.frames - endFrameExclusive) / facts.sampleRateHz,
    audibleDurationSec: (endFrameExclusive - startFrame) / facts.sampleRateHz
  }
}

function checkAnalysisLimits(facts: WavMetadata, maxBuckets: number): void {
  if (facts.containerBytes > MAX_ANALYSIS_BYTES) {
    fail('analysis_too_large', `WAV exceeds the ${MAX_ANALYSIS_BYTES}-byte analysis limit`)
  }
  if (facts.channels > MAX_ANALYSIS_CHANNELS) {
    fail(
      'too_many_channels',
      `WAV has ${facts.channels} channels; maximum is ${MAX_ANALYSIS_CHANNELS}`
    )
  }
  if (!Number.isInteger(maxBuckets) || maxBuckets <= 0 || maxBuckets > MAX_PEAK_BUCKETS) {
    fail('bad_bucket_limit', `peak bucket limit must be 1..${MAX_PEAK_BUCKETS}`)
  }
}

export function analyzeWav(bytes: Uint8Array, maxBuckets = MAX_PEAK_BUCKETS): AudioAnalysis {
  const facts = parseWav(bytes)
  checkAnalysisLimits(facts, maxBuckets)

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sampleBytes = facts.bitsPerSample / 8
  const bucketCount = Math.min(maxBuckets, facts.frames)
  const min = new Array<number>(bucketCount).fill(Infinity)
  const max = new Array<number>(bucketCount).fill(-Infinity)
  const windowFrames = Math.max(1, Math.round((facts.sampleRateHz * WINDOW_MS) / 1000))
  const windowLevels: number[] = []
  let windowSquares: ScaledSquares[] = Array.from({ length: facts.channels }, () => ({
    scale: 0,
    sum: 0,
    count: 0
  }))
  const overall: ScaledSquares = { scale: 0, sum: 0, count: 0 }
  let peakAmplitude = 0
  let clippedSamples = 0
  let bucket = 0
  let bucketEnd = Math.floor(facts.frames / bucketCount)

  function finishWindow(): void {
    windowLevels.push(Math.max(0, ...windowSquares.map(rms)))
    windowSquares = Array.from({ length: facts.channels }, () => ({ scale: 0, sum: 0, count: 0 }))
  }

  for (let frame = 0; frame < facts.frames; frame++) {
    if (frame > 0 && frame % windowFrames === 0) finishWindow()
    while (frame >= bucketEnd && bucket < bucketCount - 1) {
      bucket++
      bucketEnd = Math.floor(((bucket + 1) * facts.frames) / bucketCount)
    }
    const frameOffset = facts.dataOffset + frame * facts.blockAlignBytes
    for (let channel = 0; channel < facts.channels; channel++) {
      const value = sampleAt(view, frameOffset + channel * sampleBytes, facts)
      if (!Number.isFinite(value)) {
        fail('non_finite_sample', `non-finite sample at frame ${frame}, channel ${channel}`)
      }
      const magnitude = Math.abs(value)
      peakAmplitude = Math.max(peakAmplitude, magnitude)
      if (magnitude > 1) clippedSamples++
      addSquare(overall, value)
      const squares = windowSquares[channel]
      if (!squares) throw new Error(`no window accumulator for channel ${channel}`)
      addSquare(squares, value)
      const normalized = Math.max(-1, Math.min(1, value)) || 0
      // bucket < bucketCount always; the fallbacks mirror the fill values.
      min[bucket] = Math.min(min[bucket] ?? Infinity, normalized)
      max[bucket] = Math.max(max[bucket] ?? -Infinity, normalized)
    }
  }
  finishWindow()

  return {
    version: 1,
    source: facts,
    peaks: {
      frames: facts.frames,
      sampleRateHz: facts.sampleRateHz,
      durationSec: facts.durationSec,
      min: min.map((value) => Math.fround(value) || 0),
      max: max.map((value) => Math.fround(value) || 0)
    },
    peakAmplitude,
    rmsAmplitude: rms(overall),
    clippedSamples,
    audible: audibleBounds(windowLevels, facts, windowFrames)
  }
}
