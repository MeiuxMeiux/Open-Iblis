// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { analyzeWav } from '../electron/main/media/analysis'
import { makeWav } from './fixtures/wav'

function floatData(values: number[], bits: 32 | 64 = 32): Buffer {
  const bytes = Buffer.alloc(values.length * (bits / 8))
  values.forEach((value, index) => {
    if (bits === 32) bytes.writeFloatLE(value, index * 4)
    else bytes.writeDoubleLE(value, index * 8)
  })
  return bytes
}

function pcm24(values: number[]): Buffer {
  const bytes = Buffer.alloc(values.length * 3)
  values.forEach((value, index) => {
    const raw = value < 0 ? value + 0x1000000 : value
    bytes[index * 3] = raw & 0xff
    bytes[index * 3 + 1] = (raw >>> 8) & 0xff
    bytes[index * 3 + 2] = (raw >>> 16) & 0xff
  })
  return bytes
}

function floatWav(
  values: number[],
  options: { sampleRateHz?: number; channels?: number } = {}
): Buffer {
  return makeWav({
    codec: 'ieee-float',
    bitsPerSample: 32,
    sampleRateHz: options.sampleRateHz ?? 1000,
    channels: options.channels ?? 1,
    data: floatData(values)
  })
}

describe('WAV analysis', () => {
  it('decodes every supported PCM depth and float width', () => {
    const cases = [
      makeWav({ bitsPerSample: 8, data: Buffer.from([0, 128, 255]) }),
      makeWav({ bitsPerSample: 16, data: Buffer.from([0x00, 0x80, 0x00, 0x00, 0xff, 0x7f]) }),
      makeWav({ bitsPerSample: 24, data: pcm24([-8388608, 0, 8388607]) }),
      makeWav({
        bitsPerSample: 32,
        data: Buffer.from([0, 0, 0, 128, 0, 0, 0, 0, 255, 255, 255, 127])
      }),
      makeWav({ codec: 'ieee-float', bitsPerSample: 32, data: floatData([-1, 0, 1]) }),
      makeWav({ codec: 'ieee-float', bitsPerSample: 64, data: floatData([-1, 0, 1], 64) })
    ]

    for (const wav of cases) {
      const result = analyzeWav(wav, 1)
      expect(result.peaks.min[0]).toBe(-1)
      expect(result.peaks.max[0]).toBeGreaterThan(0.99)
      expect(result.peakAmplitude).toBeGreaterThanOrEqual(0.99)
    }
  })

  it('preserves opposite-polarity stereo extrema and records clipping', () => {
    const result = analyzeWav(
      makeWav({
        codec: 'ieee-float',
        channels: 2,
        sampleRateHz: 1000,
        data: floatData([0.75, -0.75, 2, -2])
      }),
      1
    )
    expect(result.peaks.min).toEqual([-1])
    expect(result.peaks.max).toEqual([1])
    expect(result.peakAmplitude).toBe(2)
    expect(result.clippedSamples).toBe(2)
  })

  it('partitions non-divisible frame counts exactly without interpolation', () => {
    const result = analyzeWav(floatWav([-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8]), 4)
    expect(result.peaks.min).toEqual([-1, Math.fround(-0.6), 0, Math.fround(0.4)])
    expect(result.peaks.max).toEqual([
      Math.fround(-0.8),
      Math.fround(-0.2),
      Math.fround(0.2),
      Math.fround(0.8)
    ])
  })

  it('computes global RMS and rejects non-finite float samples', () => {
    const result = analyzeWav(floatWav([-1, 1]), 1)
    expect(result.rmsAmplitude).toBe(1)

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => analyzeWav(floatWav([value]))).toThrow(
        expect.objectContaining({ code: 'non_finite_sample' })
      )
    }
  })

  it('finds sustained audible bounds with attack and reverb padding', () => {
    const samples = new Array<number>(1500).fill(0)
    samples.fill(0.1, 300, 700)
    const result = analyzeWav(floatWav(samples))
    expect(result.audible).toMatchObject({
      classification: 'audible',
      detectedStartFrame: 300,
      detectedEndFrameExclusive: 700,
      startFrame: 250,
      endFrameExclusive: 1200,
      leadingSilenceSec: 0.25,
      trailingSilenceSec: 0.3,
      audibleDurationSec: 0.95
    })
  })

  it('keeps silence and short transients distinct', () => {
    const silent = analyzeWav(floatWav(new Array<number>(1000).fill(0)))
    expect(silent.audible).toMatchObject({
      classification: 'silent',
      leadingSilenceSec: 1,
      trailingSilenceSec: 1
    })

    const click = new Array<number>(1000).fill(0)
    click.fill(0.1, 300, 320)
    const indeterminate = analyzeWav(floatWav(click))
    expect(indeterminate.audible).toMatchObject({
      classification: 'indeterminate',
      startFrame: 0,
      endFrameExclusive: 1000,
      leadingSilenceSec: 0,
      trailingSilenceSec: 0
    })
  })
})
