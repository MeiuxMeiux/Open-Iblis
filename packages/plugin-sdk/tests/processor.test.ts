// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  CANONICAL_KEY_PITCH_CLASSES,
  MAX_PROCESSOR_ALTERNATIVES,
  PROCESSOR_PROTOCOL_VERSION,
  parseBpmDetectionValueV1,
  parseKeyDetectionValueV1,
  parseProcessorAnalysisResultsV1,
  type BpmDetectionValueV1,
  type KeyDetectionValueV1,
  type ProcessorBatchRequestV1,
  type ProcessorJobStateV1
} from '../src/index.js'

const bpm: BpmDetectionValueV1 = {
  schemaVersion: 1,
  bpm: 173.8,
  confidence: null,
  alternatives: [{ bpm: 86.9, confidence: 0.42 }]
}

const key: KeyDetectionValueV1 = {
  schemaVersion: 1,
  pitchClass: 'F#',
  mode: 'minor',
  confidence: 0.81,
  alternatives: [{ pitchClass: 'A', mode: 'major', confidence: null }]
}

function expectFailure(result: { ok: boolean; errors?: string[] }, fragment: string): void {
  expect(result.ok).toBe(false)
  expect(result.errors?.some((error) => error.includes(fragment))).toBe(true)
}

describe('processor protocol v1', () => {
  it('types a capability-batched request and terminal job state', () => {
    const request: ProcessorBatchRequestV1 = {
      protocolVersion: PROCESSOR_PROTOCOL_VERSION,
      jobId: 'job-1',
      input: {
        trackId: 'track-1',
        audioPath: 'C:\\Iblis\\tracks\\track-1\\audio.wav',
        sourceSha256: 'a'.repeat(64)
      },
      capabilities: ['bpm-detect', 'key-detect']
    }
    const state: ProcessorJobStateV1 = {
      protocolVersion: 1,
      jobId: request.jobId,
      status: 'done',
      progress: 1,
      results: [
        { capability: 'bpm-detect', value: bpm },
        { capability: 'key-detect', value: key }
      ]
    }

    expect(request.capabilities).toEqual(['bpm-detect', 'key-detect'])
    expect(state.status).toBe('done')
  })
})

describe('parseBpmDetectionValueV1', () => {
  it('accepts decimal BPM, nullable confidence, and bounded alternatives', () => {
    expect(parseBpmDetectionValueV1(bpm)).toEqual({ ok: true, value: bpm })
    expect(parseBpmDetectionValueV1({ ...bpm, confidence: 0 })).toMatchObject({ ok: true })
    expect(parseBpmDetectionValueV1({ ...bpm, confidence: 1 })).toMatchObject({ ok: true })
  })

  it('rejects unknown fields, missing normalized arrays, and bad schema versions', () => {
    expectFailure(parseBpmDetectionValueV1({ ...bpm, estimate: 174 }), '.estimate')
    expectFailure(
      parseBpmDetectionValueV1({
        schemaVersion: bpm.schemaVersion,
        bpm: bpm.bpm,
        confidence: bpm.confidence
      }),
      '.alternatives'
    )
    expectFailure(parseBpmDetectionValueV1({ ...bpm, schemaVersion: 2 }), '.schemaVersion')
  })

  it('rejects non-finite/out-of-range values and invented confidence', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 0, 1000.1]) {
      expectFailure(parseBpmDetectionValueV1({ ...bpm, bpm: value }), '.bpm')
    }
    for (const confidence of [undefined, Number.NaN, -0.1, 1.1]) {
      expectFailure(parseBpmDetectionValueV1({ ...bpm, confidence }), '.confidence')
    }
  })

  it('rejects malformed, excessive, and duplicate alternatives', () => {
    expectFailure(parseBpmDetectionValueV1({ ...bpm, alternatives: {} }), '.alternatives')
    expectFailure(
      parseBpmDetectionValueV1({
        ...bpm,
        alternatives: Array.from({ length: MAX_PROCESSOR_ALTERNATIVES + 1 }, (_, index) => ({
          bpm: 100 + index,
          confidence: null
        }))
      }),
      '.alternatives'
    )
    expectFailure(
      parseBpmDetectionValueV1({
        ...bpm,
        alternatives: [{ bpm: bpm.bpm, confidence: 0.1 }]
      }),
      'duplicate'
    )
    expectFailure(
      parseBpmDetectionValueV1({
        ...bpm,
        alternatives: [{ bpm: 87, confidence: null, label: 'half time' }]
      }),
      '.label'
    )
  })
})

describe('parseKeyDetectionValueV1', () => {
  it('accepts each closed canonical pitch class', () => {
    for (const pitchClass of CANONICAL_KEY_PITCH_CLASSES) {
      expect(parseKeyDetectionValueV1({ ...key, pitchClass })).toMatchObject({ ok: true })
    }
  })

  it('rejects enharmonic aliases, open-ended modes, and unknown fields', () => {
    expectFailure(parseKeyDetectionValueV1({ ...key, pitchClass: 'Gb' }), '.pitchClass')
    expectFailure(parseKeyDetectionValueV1({ ...key, mode: 'dorian' }), '.mode')
    expectFailure(parseKeyDetectionValueV1({ ...key, label: 'F-sharp minor' }), '.label')
  })

  it('rejects malformed and duplicate alternatives', () => {
    expectFailure(parseKeyDetectionValueV1({ ...key, alternatives: null }), '.alternatives')
    expectFailure(
      parseKeyDetectionValueV1({
        ...key,
        alternatives: [{ pitchClass: key.pitchClass, mode: key.mode, confidence: null }]
      }),
      'duplicate'
    )
    expectFailure(
      parseKeyDetectionValueV1({
        ...key,
        alternatives: [{ pitchClass: 'A', mode: 'major' }]
      }),
      '.confidence'
    )
  })
})

describe('parseProcessorAnalysisResultsV1', () => {
  const results = [
    { capability: 'bpm-detect', value: bpm },
    { capability: 'key-detect', value: key }
  ]

  it('accepts one or both normalized capability results', () => {
    expect(parseProcessorAnalysisResultsV1(results.slice(0, 1))).toMatchObject({ ok: true })
    expect(parseProcessorAnalysisResultsV1(results)).toEqual({ ok: true, value: results })
  })

  it('rejects empty, oversized, duplicate, unsupported, and malformed batches', () => {
    expectFailure(parseProcessorAnalysisResultsV1([]), 'expected 1 through 2')
    expectFailure(parseProcessorAnalysisResultsV1([...results, results[0]]), 'expected 1 through 2')
    expectFailure(parseProcessorAnalysisResultsV1([results[0], results[0]]), 'duplicate')
    expectFailure(
      parseProcessorAnalysisResultsV1([{ capability: 'loudness', value: {} }]),
      'unsupported'
    )
    expectFailure(
      parseProcessorAnalysisResultsV1([{ ...results[0], provider: 'untrusted' }]),
      '.provider'
    )
    expectFailure(parseProcessorAnalysisResultsV1([null]), 'expected an object')
  })
})
