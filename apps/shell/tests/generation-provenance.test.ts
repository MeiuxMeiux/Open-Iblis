// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GENERATION_FILENAME,
  MAX_GENERATION_BYTES,
  addGenerationAnalysis,
  readGenerationRecord,
  resolvedRecipes,
  writeGenerationRecord
} from '../electron/main/library/provenance'
import type { TrackRecord } from '../electron/main/library/store'
import type { AudioAnalysis, WavFacts } from '../shared/contract'

let root: string

const facts: WavFacts = {
  containerBytes: 384044,
  formatTag: 3,
  codecTag: 3,
  codec: 'ieee-float',
  sampleRateHz: 48000,
  channels: 2,
  bitsPerSample: 32,
  blockAlignBytes: 8,
  byteRateBytesPerSec: 384000,
  dataOffset: 44,
  dataBytes: 384000,
  frames: 48000,
  durationSec: 1
}

function track(): TrackRecord {
  return {
    id: '01testtrack000000000000000',
    createdAt: 100,
    updatedAt: 100,
    name: 'Test',
    prompt: 'dark bass',
    requestedDurationSec: 1,
    durationSec: 1,
    audio: facts,
    filePath: join(root, 'audio.wav'),
    format: 'wav',
    rating: 0,
    tags: []
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'iblis-generation-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('bounded generation provenance', () => {
  it('persists exact request, timings and an allowlisted resolved recipe atomically', async () => {
    const value = track()
    const record = await writeGenerationRecord(value, {
      jobId: 'host-1',
      request: {
        prompt: 'dark bass',
        lyrics: '[Instrumental]',
        durationSec: 1,
        preset: 'fast',
        seed: 7,
        config: { negativePrompt: 'pop', steps: 8 }
      },
      startedAt: 1000,
      finishedAt: 1060,
      phases: [
        { phase: 'lm', startedAt: 1000, finishedAt: 1020, durationMs: 20, engineJobId: 'lm-1' },
        {
          phase: 'synth',
          startedAt: 1020,
          finishedAt: 1050,
          durationMs: 30,
          engineJobId: 'synth-1'
        },
        { phase: 'finishing', startedAt: 1050, finishedAt: 1060, durationMs: 10 }
      ],
      trace: [{ at: 1000, event: 'started' }],
      resolvedSynthText: JSON.stringify([
        { caption: 'resolved', audio_codes: '1,2,3', solver: 'euler', private_path: 'C:\\secret' }
      ]),
      effectiveRequest: { caption: 'dark bass', inference_steps: 8 },
      engine: { id: 'engine', version: '0.1.4' }
    })

    expect(record.request.config).toEqual({ negativePrompt: 'pop', steps: 8 })
    expect(record.resolvedRecipes).toEqual([
      { caption: 'resolved', inference_steps: 8, audio_codes: '1,2,3', solver: 'euler' }
    ])
    expect((await readGenerationRecord(value))?.phases[1]?.engineJobId).toBe('synth-1')
    await expect(readFile(join(root, `${GENERATION_FILENAME}.tmp`), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('adds measured levels, clipping, silence and the analysis source hash', async () => {
    const value = track()
    await writeGenerationRecord(value, {
      jobId: 'host-2',
      request: { prompt: 'p', durationSec: 1, preset: 'fast' },
      startedAt: 1,
      finishedAt: 2,
      phases: [],
      trace: [],
      resolvedSynthText: '[]',
      effectiveRequest: { caption: 'p', inference_steps: 8 },
      engine: { id: 'engine', version: null }
    })
    await writeFile(
      join(root, 'analysis.v1.json'),
      JSON.stringify({ identity: { sha256: 'a'.repeat(64) } }),
      'utf8'
    )
    const analysis: AudioAnalysis = {
      version: 1,
      source: facts,
      peaks: { frames: 48000, sampleRateHz: 48000, durationSec: 1, min: [-0.5], max: [0.5] },
      peakAmplitude: 0.5,
      rmsAmplitude: 0.2,
      clippedSamples: 0,
      audible: {
        classification: 'audible',
        algorithm: 'sustained-channel-rms-v1',
        openDbfs: -45,
        closeDbfs: -51,
        windowFrames: 480,
        openWindows: 5,
        closeWindows: 15,
        attackPadMs: 50,
        reverbPadMs: 500,
        detectedStartFrame: 4800,
        detectedEndFrameExclusive: 43200,
        startFrame: 2400,
        endFrameExclusive: 48000,
        leadingSilenceSec: 0.05,
        trailingSilenceSec: 0,
        audibleDurationSec: 0.95
      }
    }
    await addGenerationAnalysis(value, analysis)
    expect((await readGenerationRecord(value))?.output.analysis).toMatchObject({
      sourceSha256: 'a'.repeat(64),
      peakAmplitude: 0.5,
      clippedSamples: 0
    })
  })

  it('rejects oversized or malformed records and bounds untrusted LM output', async () => {
    const value = track()
    await writeFile(join(root, GENERATION_FILENAME), 'x'.repeat(MAX_GENERATION_BYTES + 1), 'utf8')
    await expect(readGenerationRecord(value)).resolves.toBeNull()
    expect(resolvedRecipes('{bad')).toEqual([])
    expect(resolvedRecipes(JSON.stringify([{ audio_codes: 'x'.repeat(129 * 1024) }]))).toEqual([])

    await writeGenerationRecord(value, {
      jobId: 'host-3',
      request: { prompt: 'p', durationSec: 1, preset: 'fast' },
      startedAt: 1,
      finishedAt: 2,
      phases: [],
      trace: [],
      resolvedSynthText: '[{"caption":"safe"}]',
      effectiveRequest: { caption: 'p', inference_steps: 8 },
      engine: { id: 'engine', version: null }
    })
    const path = join(root, GENERATION_FILENAME)
    const tampered = JSON.parse(await readFile(path, 'utf8')) as {
      resolvedRecipes: Record<string, unknown>[]
    }
    tampered.resolvedRecipes[0]!.private_path = 'C:\\private'
    await writeFile(path, JSON.stringify(tampered), 'utf8')
    await expect(readGenerationRecord(value)).resolves.toBeNull()
  })
})
