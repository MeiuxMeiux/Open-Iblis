// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Adapters that run the bundled third-party detectors and normalize their
// output to the processor contract. Confidence is passed through only when
// the library itself reports a bounded measure; otherwise it is null (the
// contract forbids manufacturing calibration).

import type { BpmDetectionValueV1, KeyDetectionValueV1 } from '@iblis/plugin-sdk'
import { CANONICAL_KEY_PITCH_CLASSES, type CanonicalKeyPitchClass } from '@iblis/plugin-sdk'
import MusicTempo from 'music-tempo'
import * as essentiaPackage from 'essentia.js'
import aubioFactory from 'aubiojs'

const FLAT_TO_SHARP: Record<string, CanonicalKeyPitchClass> = {
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
  Db: 'C#',
  Eb: 'D#',
  Fb: 'E',
  Gb: 'F#'
}

function canonicalPitchClass(raw: string): CanonicalKeyPitchClass {
  const mapped = FLAT_TO_SHARP[raw] ?? raw
  const match = CANONICAL_KEY_PITCH_CLASSES.find((candidate) => candidate === mapped)
  if (!match) throw new Error(`detector returned an unknown pitch class: ${raw}`)
  return match
}

function boundedBpm(value: number, source: string): number {
  if (!Number.isFinite(value) || value < 1 || value > 1000) {
    throw new Error(`${source} returned an out-of-range tempo`)
  }
  return value
}

export function musicTempoBpm(samples: Float32Array): BpmDetectionValueV1 {
  const analysis = new MusicTempo(samples)
  const bpm = boundedBpm(Number.parseFloat(analysis.tempo), 'MusicTempo')
  return { schemaVersion: 1, bpm, confidence: null, alternatives: [] }
}

export async function aubioBpm(
  samples: Float32Array,
  sampleRate: number
): Promise<BpmDetectionValueV1> {
  const { Tempo } = await aubioFactory()
  const hop = 512
  const tempo = new Tempo(1024, hop, sampleRate)
  for (let offset = 0; offset + hop <= samples.length; offset += hop) {
    tempo.do(samples.subarray(offset, offset + hop))
  }
  const bpm = boundedBpm(tempo.getBpm(), 'aubio')
  // aubio's confidence is unbounded above 1; the contract wants 0..1 or null.
  return { schemaVersion: 1, bpm, confidence: null, alternatives: [] }
}

interface EssentiaSession {
  bpm(samples: Float32Array, sampleRate: number): BpmDetectionValueV1
  key(samples: Float32Array, sampleRate: number): KeyDetectionValueV1
}

// One WASM instantiation per worker; the worker exits after its single job.
let essentiaInstance: InstanceType<typeof essentiaPackage.Essentia> | null = null

function essentia(): EssentiaSession {
  essentiaInstance ??= new essentiaPackage.Essentia(essentiaPackage.EssentiaWASM)
  const instance = essentiaInstance
  return {
    bpm(samples, sampleRate) {
      const vector = instance.arrayToVector(samples)
      try {
        const result = instance.PercivalBpmEstimator(
          vector,
          1024,
          2048,
          128,
          128,
          210,
          50,
          sampleRate
        )
        return {
          schemaVersion: 1,
          bpm: boundedBpm(result.bpm, 'Essentia'),
          confidence: null,
          alternatives: []
        }
      } finally {
        vector.delete()
      }
    },
    key(samples, sampleRate) {
      const vector = instance.arrayToVector(samples)
      try {
        const result = instance.KeyExtractor(
          vector,
          true,
          4096,
          4096,
          12,
          3500,
          60,
          25,
          0.2,
          'bgate',
          sampleRate,
          0.0001,
          440,
          'cosine',
          'hann'
        )
        if (result.scale !== 'major' && result.scale !== 'minor') {
          throw new Error(`Essentia returned an unknown scale: ${result.scale}`)
        }
        return {
          schemaVersion: 1,
          pitchClass: canonicalPitchClass(result.key),
          mode: result.scale,
          confidence: Math.max(0, Math.min(1, result.strength)),
          alternatives: []
        }
      } finally {
        vector.delete()
      }
    }
  }
}

export function essentiaBpm(samples: Float32Array, sampleRate: number): BpmDetectionValueV1 {
  return essentia().bpm(samples, sampleRate)
}

export function essentiaKey(samples: Float32Array, sampleRate: number): KeyDetectionValueV1 {
  return essentia().key(samples, sampleRate)
}
