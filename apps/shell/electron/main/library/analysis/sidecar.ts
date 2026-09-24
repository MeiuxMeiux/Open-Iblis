// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AudioAnalysis, AudibleBounds, WavFacts } from '../../../../shared/contract'
import { MAX_ANALYSIS_BYTES, MAX_PEAK_BUCKETS } from '../../media/analysis'

export const ANALYSIS_FILENAME = 'analysis.v1.json'

export interface AnalysisSourceIdentity {
  sha256: string
  size: number
  mtimeMs: number
}

interface PersistedEnvelope {
  frames: number
  sampleRateHz: number
  durationSec: number
  encoding: 'f32le-interleaved-min-max'
  buckets: number
  data: string
}

interface PersistedAnalysis {
  schema: 1
  analyzer: 'iblis-waveform-v1'
  identity: AnalysisSourceIdentity
  source: WavFacts
  envelope: PersistedEnvelope
  peakAmplitude: number
  rmsAmplitude: number
  clippedSamples: number
  audible: AudibleBounds
}

// A sidecar read back from disk is untrusted: tags may hold any string and
// nested records may be missing, so the decoder validates the loose shape.
type ParsedEnvelope = Omit<PersistedEnvelope, 'encoding'> & { encoding: string }
type ParsedAudible = Omit<AudibleBounds, 'algorithm'> & { algorithm: string }

interface ParsedAnalysis {
  schema: number
  analyzer: string
  identity?: AnalysisSourceIdentity
  source?: WavFacts
  envelope?: ParsedEnvelope
  peakAmplitude: number
  rmsAmplitude: number
  clippedSamples: number
  audible?: ParsedAudible
}

const FACT_KEYS: (keyof WavFacts)[] = [
  'containerBytes',
  'formatTag',
  'codecTag',
  'codec',
  'sampleRateHz',
  'channels',
  'bitsPerSample',
  'validBitsPerSample',
  'channelMask',
  'blockAlignBytes',
  'byteRateBytesPerSec',
  'dataOffset',
  'dataBytes',
  'frames',
  'durationSec'
]

function factsMatch(actual: WavFacts, expected: WavFacts): boolean {
  return FACT_KEYS.every((key) => actual[key] === expected[key])
}

function validFacts(facts: WavFacts | undefined, size: number): boolean {
  if (
    !facts ||
    !integer(size) ||
    size <= 0 ||
    size > MAX_ANALYSIS_BYTES ||
    facts.containerBytes !== size ||
    !['pcm', 'ieee-float'].includes(facts.codec)
  ) {
    return false
  }
  const extensible = facts.formatTag === 0xfffe
  const extensibleFields = extensible
    ? integer(facts.validBitsPerSample) &&
      facts.validBitsPerSample > 0 &&
      facts.validBitsPerSample <= facts.bitsPerSample &&
      uint(facts.channelMask, 0xffffffff)
    : facts.validBitsPerSample === undefined && facts.channelMask === undefined
  return (
    uint(facts.formatTag, 0xffff) &&
    [1, 3, 0xfffe].includes(facts.formatTag) &&
    uint(facts.codecTag, 0xffff) &&
    (extensible || facts.formatTag === facts.codecTag) &&
    (facts.codec === 'pcm'
      ? [8, 16, 24, 32].includes(facts.bitsPerSample)
      : [32, 64].includes(facts.bitsPerSample)) &&
    uint(facts.sampleRateHz, 0xffffffff) &&
    facts.sampleRateHz > 0 &&
    uint(facts.channels, 32) &&
    facts.channels > 0 &&
    uint(facts.bitsPerSample, 0xffff) &&
    uint(facts.blockAlignBytes, 0xffff) &&
    facts.blockAlignBytes > 0 &&
    uint(facts.byteRateBytesPerSec, 0xffffffff) &&
    facts.byteRateBytesPerSec > 0 &&
    uint(facts.dataOffset, 0xffffffff) &&
    facts.dataOffset >= 20 &&
    uint(facts.dataBytes, 0xffffffff) &&
    facts.dataBytes > 0 &&
    integer(facts.frames) &&
    facts.frames > 0 &&
    extensibleFields &&
    facts.codecTag === (facts.codec === 'pcm' ? 1 : 3) &&
    facts.blockAlignBytes === facts.channels * (facts.bitsPerSample / 8) &&
    facts.byteRateBytesPerSec === facts.sampleRateHz * facts.blockAlignBytes &&
    facts.dataBytes === facts.frames * facts.blockAlignBytes &&
    facts.dataOffset + facts.dataBytes <= size &&
    facts.durationSec === facts.frames / facts.sampleRateHz
  )
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function integer(value: unknown): value is number {
  return finite(value) && Number.isInteger(value)
}

function uint(value: unknown, maximum: number): value is number {
  return integer(value) && value >= 0 && value <= maximum
}

function validAudible(value: ParsedAudible | undefined, facts: WavFacts): value is AudibleBounds {
  if (
    value?.algorithm !== 'sustained-channel-rms-v1' ||
    !['audible', 'silent', 'indeterminate'].includes(value.classification) ||
    value.openDbfs !== -45 ||
    value.closeDbfs !== -51 ||
    !integer(value.windowFrames) ||
    value.windowFrames !== Math.max(1, Math.round((facts.sampleRateHz * 10) / 1000)) ||
    value.openWindows !== 5 ||
    value.closeWindows !== 15 ||
    value.attackPadMs !== 50 ||
    value.reverbPadMs !== 500 ||
    !finite(value.leadingSilenceSec) ||
    !finite(value.trailingSilenceSec) ||
    value.leadingSilenceSec < 0 ||
    value.trailingSilenceSec < 0
  ) {
    return false
  }

  const frame = (candidate: unknown): candidate is number =>
    integer(candidate) && candidate >= 0 && candidate <= facts.frames
  if (value.classification === 'silent') {
    return (
      value.startFrame === undefined &&
      value.endFrameExclusive === undefined &&
      value.detectedStartFrame === undefined &&
      value.detectedEndFrameExclusive === undefined &&
      value.audibleDurationSec === undefined &&
      value.leadingSilenceSec === facts.durationSec &&
      value.trailingSilenceSec === facts.durationSec
    )
  }
  if (!frame(value.startFrame) || !frame(value.endFrameExclusive)) return false
  if (value.startFrame >= value.endFrameExclusive) return false
  if (
    !finite(value.audibleDurationSec) ||
    value.audibleDurationSec !== (value.endFrameExclusive - value.startFrame) / facts.sampleRateHz
  ) {
    return false
  }
  if (
    value.leadingSilenceSec !== value.startFrame / facts.sampleRateHz ||
    value.trailingSilenceSec !== (facts.frames - value.endFrameExclusive) / facts.sampleRateHz
  ) {
    return false
  }
  if (value.classification === 'indeterminate') {
    return (
      value.detectedStartFrame === undefined &&
      value.detectedEndFrameExclusive === undefined &&
      value.startFrame === 0 &&
      value.endFrameExclusive === facts.frames
    )
  }
  const attackFrames = Math.round((facts.sampleRateHz * value.attackPadMs) / 1000)
  const reverbFrames = Math.round((facts.sampleRateHz * value.reverbPadMs) / 1000)
  if (!frame(value.detectedStartFrame) || !frame(value.detectedEndFrameExclusive)) return false
  const minimumOpenEnd = Math.min(
    facts.frames,
    value.detectedStartFrame + value.openWindows * value.windowFrames
  )
  return (
    value.detectedStartFrame < value.detectedEndFrameExclusive &&
    value.detectedStartFrame % value.windowFrames === 0 &&
    (value.detectedEndFrameExclusive === facts.frames ||
      value.detectedEndFrameExclusive % value.windowFrames === 0) &&
    value.detectedStartFrame + (value.openWindows - 1) * value.windowFrames < facts.frames &&
    value.detectedEndFrameExclusive >= minimumOpenEnd &&
    value.startFrame === Math.max(0, value.detectedStartFrame - attackFrames) &&
    value.endFrameExclusive ===
      Math.min(facts.frames, value.detectedEndFrameExclusive + reverbFrames)
  )
}

function decodeEnvelope(
  envelope: ParsedEnvelope | undefined,
  facts: WavFacts
): AudioAnalysis['peaks'] | null {
  if (
    envelope?.encoding !== 'f32le-interleaved-min-max' ||
    envelope.frames !== facts.frames ||
    envelope.sampleRateHz !== facts.sampleRateHz ||
    envelope.durationSec !== facts.durationSec ||
    !integer(envelope.buckets) ||
    envelope.buckets !== Math.min(MAX_PEAK_BUCKETS, facts.frames) ||
    typeof envelope.data !== 'string'
  ) {
    return null
  }
  const encodedBytes = envelope.buckets * 8
  if (envelope.data.length !== Math.ceil(encodedBytes / 3) * 4) return null
  const bytes = Buffer.from(envelope.data, 'base64')
  if (bytes.length !== encodedBytes || bytes.toString('base64') !== envelope.data) return null
  const min: number[] = []
  const max: number[] = []
  for (let index = 0; index < envelope.buckets; index++) {
    const low = bytes.readFloatLE(index * 8)
    const high = bytes.readFloatLE(index * 8 + 4)
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < -1 || high > 1 || low > high) {
      return null
    }
    min.push(low || 0)
    max.push(high || 0)
  }
  if (facts.channels === 1 && facts.frames === envelope.buckets) {
    if (min.some((low, index) => low !== max[index])) return null
  }
  return {
    frames: facts.frames,
    sampleRateHz: facts.sampleRateHz,
    durationSec: facts.durationSec,
    min,
    max
  }
}

function validMetrics(value: AudioAnalysis): boolean {
  const peaks = value.peaks
  const sampleCount = value.source.frames * value.source.channels
  const normalizedPeak = Math.min(1, value.peakAmplitude)
  const envelopeMagnitudes = peaks.min.map((low, index) =>
    // A missing max yields NaN, which fails the peak comparison below.
    Math.max(Math.abs(low), Math.abs(peaks.max[index] ?? Number.NaN))
  )
  const envelopePeak = Math.max(0, ...envelopeMagnitudes)
  const amplitudeTolerance = 1e-7
  const rmsTolerance =
    Number.EPSILON * Math.max(value.peakAmplitude, value.rmsAmplitude, Number.MIN_VALUE) * 16
  if (
    envelopePeak !== Math.abs(Math.fround(normalizedPeak)) ||
    value.rmsAmplitude > value.peakAmplitude + rmsTolerance ||
    value.rmsAmplitude + rmsTolerance < value.peakAmplitude / Math.sqrt(sampleCount) ||
    value.rmsAmplitude + rmsTolerance < Math.sqrt(value.clippedSamples / sampleCount) ||
    (value.peakAmplitude <= 1 && value.clippedSamples !== 0) ||
    (value.peakAmplitude > 1 && value.clippedSamples === 0) ||
    (value.audible.classification !== 'silent' &&
      value.peakAmplitude < 10 ** (value.audible.openDbfs / 20))
  ) {
    return false
  }

  const minimumEnvelopeRms = Math.sqrt(
    envelopeMagnitudes.reduce((sum, magnitude) => sum + magnitude * magnitude, 0) / sampleCount
  )
  if (value.rmsAmplitude + amplitudeTolerance < minimumEnvelopeRms) return false
  if (value.peakAmplitude > 1) return true

  const maximumEnvelopeRms = Math.sqrt(
    envelopeMagnitudes.reduce((sum, magnitude, index) => {
      const start = Math.floor((index * value.source.frames) / envelopeMagnitudes.length)
      const end = Math.floor(((index + 1) * value.source.frames) / envelopeMagnitudes.length)
      return sum + (end - start) * (magnitude + amplitudeTolerance) ** 2
    }, 0) / value.source.frames
  )
  return value.rmsAmplitude <= maximumEnvelopeRms + amplitudeTolerance
}

export function encodeAnalysisSidecar(
  analysis: AudioAnalysis,
  identity: AnalysisSourceIdentity
): string {
  const data = Buffer.alloc(analysis.peaks.min.length * 8)
  for (let index = 0; index < analysis.peaks.min.length; index++) {
    // A missing max writes NaN, which the decode-side validation rejects.
    data.writeFloatLE(analysis.peaks.min[index] ?? Number.NaN, index * 8)
    data.writeFloatLE(analysis.peaks.max[index] ?? Number.NaN, index * 8 + 4)
  }
  const persisted: PersistedAnalysis = {
    schema: 1,
    analyzer: 'iblis-waveform-v1',
    identity,
    source: analysis.source,
    envelope: {
      frames: analysis.peaks.frames,
      sampleRateHz: analysis.peaks.sampleRateHz,
      durationSec: analysis.peaks.durationSec,
      encoding: 'f32le-interleaved-min-max',
      buckets: analysis.peaks.min.length,
      data: data.toString('base64')
    },
    peakAmplitude: analysis.peakAmplitude,
    rmsAmplitude: analysis.rmsAmplitude,
    clippedSamples: analysis.clippedSamples,
    audible: analysis.audible
  }
  return `${JSON.stringify(persisted)}\n`
}

export function decodeAnalysisSidecar(
  text: string,
  expected: { facts?: WavFacts; size: number; mtimeMs: number }
): AudioAnalysis | null {
  let value: ParsedAnalysis | null
  try {
    value = JSON.parse(text) as ParsedAnalysis | null
  } catch {
    return null
  }
  if (
    value?.schema !== 1 ||
    value.analyzer !== 'iblis-waveform-v1' ||
    !value.identity ||
    !/^[a-f0-9]{64}$/.test(value.identity.sha256) ||
    value.identity.size !== expected.size ||
    value.identity.mtimeMs !== expected.mtimeMs ||
    !value.source ||
    !validFacts(value.source, expected.size) ||
    (expected.facts !== undefined && !factsMatch(value.source, expected.facts)) ||
    !finite(value.peakAmplitude) ||
    value.peakAmplitude < 0 ||
    !finite(value.rmsAmplitude) ||
    value.rmsAmplitude < 0 ||
    !integer(value.clippedSamples) ||
    value.clippedSamples < 0 ||
    value.clippedSamples > value.source.frames * value.source.channels ||
    !validAudible(value.audible, value.source)
  ) {
    return null
  }
  const peaks = decodeEnvelope(value.envelope, value.source)
  if (!peaks) return null
  const analysis: AudioAnalysis = {
    version: 1,
    source: value.source,
    peaks,
    peakAmplitude: value.peakAmplitude,
    rmsAmplitude: value.rmsAmplitude,
    clippedSamples: value.clippedSamples,
    audible: value.audible
  }
  return validMetrics(analysis) ? analysis : null
}
