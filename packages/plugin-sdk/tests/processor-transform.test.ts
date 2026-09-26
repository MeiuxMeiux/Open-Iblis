// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  isTransformJobId,
  parseStemHealthV2,
  parseStemJobStateV2,
  parseTransformAcceptedV2
} from '../src/index.js'

const done = {
  protocolVersion: 2,
  jobId: 'job-1',
  status: 'done',
  progress: 1,
  backend: 'gpu',
  outputs: [
    { role: 'stem.vocals', path: 'vocals.wav', peakDb: -1.2, rmsDb: -18 },
    { role: 'stem.drums', path: 'drums.wav', peakDb: -0.4, rmsDb: -16.5 }
  ],
  metrics: { sampleRate: 48000, frames: 480000, seconds: 10, residualDb: -41.2, computeMs: 5300 }
}

describe('parseStemJobStateV2', () => {
  it('accepts a complete done state and drops unknown diagnostics', () => {
    const parsed = parseStemJobStateV2({ ...done, debug: { x: 1 } }, 'job-1')
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.value.status === 'done') {
      expect(parsed.value.outputs.map((o) => o.role)).toEqual(['stem.vocals', 'stem.drums'])
      expect(parsed.value).not.toHaveProperty('debug')
    }
  })

  it('refuses a mismatched job id', () => {
    expect(parseStemJobStateV2(done, 'job-2').ok).toBe(false)
  })

  it.each([
    ['../vocals.wav'],
    ['C:\\x\\vocals.wav'],
    ['sub/vocals.wav'],
    ['vocals.exe'],
    ['Vocals.wav']
  ])('refuses a non-bare output file name %s', (path) => {
    const outputs = [{ role: 'stem.vocals', path, peakDb: 0, rmsDb: -10 }]
    expect(parseStemJobStateV2({ ...done, outputs }, 'job-1').ok).toBe(false)
  })

  it('refuses duplicate roles and unknown roles', () => {
    const dup = [done.outputs[0], { ...done.outputs[0], path: 'v2.wav' }]
    expect(parseStemJobStateV2({ ...done, outputs: dup }, 'job-1').ok).toBe(false)
    const unknown = [{ role: 'stem.kazoo', path: 'kazoo.wav', peakDb: 0, rmsDb: 0 }]
    expect(parseStemJobStateV2({ ...done, outputs: unknown }, 'job-1').ok).toBe(false)
  })

  it('parses running, error, and refuses unknown status', () => {
    const running = parseStemJobStateV2(
      { protocolVersion: 2, jobId: 'j', status: 'running', progress: 0.4, stage: 'separating' },
      'j'
    )
    expect(running).toEqual({
      ok: true,
      value: { status: 'running', progress: 0.4, stage: 'separating' }
    })
    const error = parseStemJobStateV2(
      { protocolVersion: 2, jobId: 'j', status: 'error', progress: 0.1, error: 'boom' },
      'j'
    )
    expect(error.ok).toBe(true)
    expect(
      parseStemJobStateV2({ protocolVersion: 2, jobId: 'j', status: 'paused', progress: 0 }, 'j').ok
    ).toBe(false)
  })

  it('refuses out-of-range progress and metrics', () => {
    expect(parseStemJobStateV2({ ...done, progress: 2 }, 'job-1').ok).toBe(false)
    const metrics = { ...done.metrics, residualDb: Number.NaN }
    expect(parseStemJobStateV2({ ...done, metrics }, 'job-1').ok).toBe(false)
  })
})

describe('transform handshake parsers', () => {
  it('parses accepted and refused', () => {
    expect(
      parseTransformAcceptedV2({ protocolVersion: 2, jobId: 'a', accepted: true }, 'a')
    ).toEqual({ ok: true, value: { accepted: true } })
    expect(
      parseTransformAcceptedV2(
        { protocolVersion: 2, jobId: 'a', accepted: false, error: 'busy' },
        'a'
      )
    ).toEqual({ ok: true, value: { accepted: false, error: 'busy' } })
    expect(
      parseTransformAcceptedV2({ protocolVersion: 1, jobId: 'a', accepted: true }, 'a').ok
    ).toBe(false)
  })

  it('parses health stems and backends', () => {
    const health = {
      ok: true,
      protocolVersion: 2,
      model: 'htdemucs_6s',
      stems: ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'],
      backends: ['gpu', 'cpu']
    }
    expect(parseStemHealthV2(health).ok).toBe(true)
    expect(parseStemHealthV2({ ...health, stems: ['kazoo'] }).ok).toBe(false)
    expect(parseStemHealthV2({ ...health, backends: ['tpu'] }).ok).toBe(false)
  })

  it('validates job ids', () => {
    expect(isTransformJobId('01J9ABC_def-1')).toBe(true)
    expect(isTransformJobId('../x')).toBe(false)
    expect(isTransformJobId('')).toBe(false)
  })
})
