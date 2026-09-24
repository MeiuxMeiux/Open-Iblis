// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { parseProcessorAnalysisResultsV1 } from '@iblis/plugin-sdk'
import { BUILTIN_PROCESSORS } from '../electron/main/processors/builtin/catalog'
import {
  ANALYSIS_SAMPLE_RATE,
  decodeWavMonoBytes
} from '../electron/main/processors/builtin/decode'
import { detectBpm, detectKey } from '../electron/main/processors/builtin/dsp'
import { runBuiltinDetector } from '../electron/main/processors/builtin/detect'

const SR = ANALYSIS_SAMPLE_RATE

// 120 BPM clicks with an A minor arpeggio (A3, C4, E4): every detector should
// land near 120 BPM and the key detectors on A minor.
function syntheticSignal(seconds = 15): Float32Array {
  const n = SR * seconds
  const x = new Float32Array(n)
  const beat = (60 / 120) * SR
  for (let b = 0; b * beat < n; b++) {
    const start = Math.round(b * beat)
    for (let i = 0; i < 800 && start + i < n; i++) {
      x[start + i]! += Math.exp(-i / 120) * Math.sin(i * 0.9) * 0.8
    }
  }
  const freqs = [220, 261.63, 329.63]
  const noteLength = beat / 2
  for (let i = 0; i < n; i++) {
    const f = freqs[Math.floor(i / noteLength) % 3]!
    x[i]! +=
      0.3 * Math.sin((2 * Math.PI * f * i) / SR) + 0.12 * Math.sin((2 * Math.PI * 2 * f * i) / SR)
  }
  return x
}

function wav16(samples: Float32Array, sampleRate: number, channels = 1): Buffer {
  const frames = Math.floor(samples.length / channels)
  const blockAlign = channels * 2
  const dataBytes = frames * blockAlign
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * blockAlign, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames * channels; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0))
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }
  return buffer
}

describe('builtin catalog', () => {
  it('declares complete evaluation disclosures', () => {
    for (const definition of BUILTIN_PROCESSORS) {
      expect(definition.id.startsWith('mx.iblis.builtin.')).toBe(true)
      expect(definition.capabilities.length).toBeGreaterThan(0)
      const evaluation = definition.evaluation
      for (const field of [
        evaluation.codeLicense,
        evaluation.termsUrl,
        evaluation.noticePath,
        evaluation.upstreamRevision,
        evaluation.acknowledgement
      ]) {
        expect(field.length).toBeGreaterThan(0)
      }
      if (evaluation.status !== 'commercial-candidate') {
        expect(evaluation.releaseBlocker ?? '').not.toBe('')
      }
    }
  })

  it('keeps ids unique', () => {
    const ids = BUILTIN_PROCESSORS.map((definition) => definition.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('decodeWavMonoBytes', () => {
  it('downmixes and resamples to the analysis rate', () => {
    const seconds = 2
    const rate = 48000
    const stereo = new Float32Array(rate * seconds * 2)
    for (let i = 0; i < rate * seconds; i++) {
      const value = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5
      stereo[i * 2] = value
      stereo[i * 2 + 1] = value
    }
    const decoded = decodeWavMonoBytes(wav16(stereo, rate, 2))
    expect(decoded.sampleRate).toBe(SR)
    expect(decoded.samples.length).toBe(Math.floor(rate * seconds * (SR / rate)))
    expect(decoded.sourceDurationSec).toBeCloseTo(seconds, 3)
    const peak = decoded.samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
    expect(peak).toBeGreaterThan(0.4)
    expect(peak).toBeLessThan(0.6)
  })

  it('rejects non-WAV bytes', () => {
    expect(() => decodeWavMonoBytes(Buffer.from('not audio'))).toThrow()
  })
})

describe('iblis-dsp detectors', () => {
  const signal = syntheticSignal()

  it('finds the tempo of a click track', () => {
    const result = detectBpm(signal, SR)
    expect(Math.abs(result.bpm - 120)).toBeLessThan(3)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.alternatives.length).toBeLessThanOrEqual(8)
  })

  it('finds the key of an A minor arpeggio', () => {
    const result = detectKey(signal, SR)
    expect(result.pitchClass).toBe('A')
    expect(result.mode).toBe('minor')
    expect(result.confidence).toBeGreaterThan(0.3)
  })
})

// Real DSP over a synthetic signal: ~2 s plain, 13+ s under v8 coverage
// instrumentation, which tripped the default 5 s limit twice (2026-09-24).
describe('built-in providers end to end (in-process)', { timeout: 30_000 }, () => {
  const signal = syntheticSignal()

  it.each(BUILTIN_PROCESSORS.map((definition) => [definition.id, definition] as const))(
    '%s returns contract-valid results',
    async (_id, definition) => {
      const results = []
      for (const capability of definition.capabilities) {
        results.push(await runBuiltinDetector(definition.id, capability, signal, SR))
      }
      const parsed = parseProcessorAnalysisResultsV1(results)
      expect(parsed.ok, parsed.ok ? '' : parsed.errors.join('; ')).toBe(true)
      for (const result of results) {
        if (result.capability === 'bpm-detect') {
          expect(Math.abs(result.value.bpm - 120)).toBeLessThan(5)
        } else {
          expect(result.value.pitchClass).toBe('A')
          expect(result.value.mode).toBe('minor')
        }
      }
    }
  )

  it('rejects an unsupported capability', async () => {
    await expect(
      runBuiltinDetector('mx.iblis.builtin.musictempo', 'key-detect', signal, SR)
    ).rejects.toThrow(/does not support/)
  })
})
