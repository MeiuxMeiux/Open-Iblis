// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  blockTrackAnalysis,
  cancelTrackAnalysis,
  ensureTrackAnalysis,
  releaseTrackAnalysis
} from '../electron/main/library/analysis'
import { parseWav } from '../electron/main/media/wav'
import type { TrackRecord } from '../electron/main/library/store'
import { maxActiveWorkers, resetWorkerStats, workerStarts } from './analysis-worker-stub'
import { makeWav } from './fixtures/wav'

const persistence = vi.hoisted(() => ({
  wait: null as Promise<void> | null,
  started: null as (() => void) | null,
  fail: false
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const originalWriteFile = actual.writeFile as unknown as (...args: unknown[]) => Promise<void>
  return {
    ...actual,
    writeFile: async (...args: unknown[]): Promise<void> => {
      if (String(args[0]).endsWith('analysis.v1.json.tmp') && persistence.wait) {
        persistence.started?.()
        await persistence.wait
        if (persistence.fail) {
          throw Object.assign(new Error('write failed at C:\\private\\tracks\\audio.wav'), {
            code: 'EIO'
          })
        }
      }
      await originalWriteFile(...args)
    }
  }
})

let root: string

function track(id: string): TrackRecord {
  const filePath = join(root, id, 'audio.wav')
  const wav = makeWav({ codec: 'ieee-float', sampleRateHz: 1000, frames: 100 })
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    name: id,
    prompt: '',
    durationSec: 0.1,
    audio: parseWav(wav),
    filePath,
    format: 'wav',
    rating: 0,
    tags: []
  }
}

async function writeTrack(value: TrackRecord): Promise<void> {
  await mkdir(dirname(value.filePath), { recursive: true })
  await writeFile(value.filePath, makeWav({ codec: 'ieee-float', sampleRateHz: 1000, frames: 100 }))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'iblis-analysis-supervisor-'))
  resetWorkerStats()
  persistence.wait = null
  persistence.started = null
  persistence.fail = false
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('track analysis supervisor', () => {
  it('deduplicates a track, serializes different tracks, and reuses the sidecar', async () => {
    const a = track('a')
    const b = track('b')
    await writeTrack(a)
    await writeTrack(b)

    const first = ensureTrackAnalysis(a)
    expect(ensureTrackAnalysis(a)).toBe(first)
    const second = ensureTrackAnalysis(b)
    await Promise.all([first, second])
    expect(workerStarts).toBe(2)
    expect(maxActiveWorkers).toBe(1)
    expect(
      JSON.parse(await readFile(join(dirname(a.filePath), 'analysis.v1.json'), 'utf8'))
    ).toMatchObject({ schema: 1, analyzer: 'iblis-waveform-v1' })

    await ensureTrackAnalysis(a)
    expect(workerStarts).toBe(2)
  })

  it('cancels analysis before a worker can retain the track file', async () => {
    const value = track('cancel')
    await writeTrack(value)
    const pending = ensureTrackAnalysis(value)
    await cancelTrackAnalysis(value.id)
    await expect(pending).rejects.toMatchObject({ code: 'analysis_cancelled' })
    expect(workerStarts).toBe(0)
  })

  it('terminates an active worker before deletion may proceed', async () => {
    const value = track('active-cancel')
    await writeTrack(value)
    const pending = ensureTrackAnalysis(value)
    while (workerStarts === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    const cancelling = cancelTrackAnalysis(value.id)
    await expect(pending).rejects.toMatchObject({ code: 'analysis_cancelled' })
    await cancelling
  })

  it('keeps new analysis blocked until deletion releases its tombstone', async () => {
    const value = track('blocked')
    await writeTrack(value)
    await blockTrackAnalysis(value.id)
    await expect(ensureTrackAnalysis(value)).rejects.toMatchObject({ code: 'analysis_cancelled' })
    releaseTrackAnalysis(value.id)
    await expect(ensureTrackAnalysis(value)).resolves.toMatchObject({ version: 1 })
  })

  it('holds the analysis tombstone around failure-atomic deletion', async () => {
    const source = await readFile(join(__dirname, '../electron/main/library/index.ts'), 'utf8')
    const body = source.slice(source.indexOf('export async function deleteTrack'))
    const blocked = body.indexOf('await blockTrackAnalysis(id)')
    const committed = body.indexOf('await commitTrackDeletion({')
    const removed = body.indexOf('await lib.remove(id)')
    const released = body.indexOf('releaseTrackAnalysis(id)')

    expect(blocked).toBeGreaterThanOrEqual(0)
    expect(committed).toBeGreaterThan(blocked)
    expect(removed).toBeGreaterThan(committed)
    expect(released).toBeGreaterThan(removed)
    expect(body.slice(removed, released)).toContain('finally')
  })

  it('reports cancellation when persistence fails after deletion blocks the track', async () => {
    const value = track('persist-cancel')
    await writeTrack(value)
    let release!: () => void
    let markStarted!: () => void
    persistence.wait = new Promise<void>((resolve) => (release = resolve))
    const started = new Promise<void>((resolve) => (markStarted = resolve))
    persistence.started = markStarted
    persistence.fail = true

    const pending = ensureTrackAnalysis(value)
    await started
    const cancelling = cancelTrackAnalysis(value.id)
    release()
    await expect(pending).rejects.toMatchObject({
      code: 'analysis_cancelled',
      message: 'track analysis cancelled'
    })
    await cancelling
  })

  it('masks filesystem paths from analysis failures', async () => {
    const value = track('path-free')
    await writeTrack(value)
    persistence.wait = Promise.resolve()
    persistence.fail = true

    await expect(ensureTrackAnalysis(value)).rejects.toMatchObject({
      code: 'EIO',
      message: 'track analysis unavailable'
    })
  })
})
