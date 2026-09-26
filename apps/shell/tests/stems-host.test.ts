// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StemJobStateV2, StemRole, StemSplitRequestV2 } from '@iblis/plugin-sdk'
import { createStemHost, type StemHostDeps } from '../electron/main/stems/host'
import type { StemSidecarClient } from '../electron/main/stems/client'
import { measureStem } from '../electron/main/stems/measure'
import { readStemSets, toStemSetView } from '../electron/main/stems/promote'
import { createStemStore } from '../electron/main/stems/store'
import { clickTrack, stereoFloatWav, tone } from './fixtures/stem-audio'

const TRACK = '01j9zzzzzzzzzzzzzzzzzzzzzz'
const SECONDS = 4
const RATE = 8000
const ROLES: [StemRole, string, (t: number) => number][] = [
  ['stem.vocals', 'vocals.wav', () => 0],
  ['stem.drums', 'drums.wav', clickTrack(120)],
  ['stem.bass', 'bass.wav', tone(55)],
  ['stem.other', 'other.wav', tone(440, 0.2)]
]

let root: string
let stores: ReturnType<typeof createStemStore>[] = []
let trackDir: string
let audioPath: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'iblis-stems-'))
  trackDir = join(root, TRACK)
  await import('node:fs/promises').then((fs) => fs.mkdir(trackDir, { recursive: true }))
  audioPath = join(trackDir, 'audio.wav')
  await writeFile(audioPath, stereoFloatWav(SECONDS, tone(220), RATE))
})

afterEach(async () => {
  // A settled job can still have its store write in flight; on Windows an
  // open handle makes the rmdir fail with EBUSY.
  await Promise.all(stores.map((store) => store.settled()))
  stores = []
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const sha = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

interface FakeOptions {
  extraFile?: boolean
  failWith?: string
  runningPolls?: number
  wrongRate?: boolean
}

function fakeClient(options: FakeOptions = {}) {
  const calls = { start: [] as StemSplitRequestV2[], cancel: [] as string[] }
  let polls = 0
  const client: StemSidecarClient = {
    health: () => Promise.resolve({ model: 'htdemucs', stems: ['vocals'], backends: ['cpu'] }),
    async start(request) {
      calls.start.push(request)
      for (const [, file, fn] of ROLES) {
        await writeFile(
          join(request.stagingDir, file),
          stereoFloatWav(SECONDS, fn, options.wrongRate ? RATE * 2 : RATE)
        )
      }
      if (options.extraFile) await writeFile(join(request.stagingDir, 'evil.exe'), 'x')
    },
    state(jobId): Promise<StemJobStateV2> {
      polls++
      if (options.failWith)
        return Promise.resolve({ status: 'error', progress: 0.2, error: options.failWith })
      if (polls <= (options.runningPolls ?? 1)) {
        return Promise.resolve({
          status: 'running',
          progress: 0.5,
          stage: 'separating',
          backend: 'cpu'
        })
      }
      void jobId
      return Promise.resolve({
        status: 'done',
        progress: 1,
        backend: 'cpu',
        outputs: ROLES.map(([role, path]) => ({ role, path, peakDb: -3, rmsDb: -20 })),
        metrics: {
          sampleRate: RATE,
          frames: SECONDS * RATE,
          seconds: SECONDS,
          residualDb: -30,
          computeMs: 1200
        }
      })
    },
    cancel(jobId) {
      calls.cancel.push(jobId)
      return Promise.resolve()
    }
  }
  return { client, calls }
}

function host(client: StemSidecarClient, overrides: Partial<StemHostDeps> = {}) {
  const store = createStemStore(join(root, 'stem-jobs.json'))
  stores.push(store)
  let id = 0
  const deps: StemHostDeps = {
    store,
    provider: (pid) =>
      pid === 'mx.test.stems'
        ? { id: pid, name: 'Test Stems', version: '1.0.0', model: 'htdemucs' }
        : null,
    defaultProvider: () => ({
      id: 'mx.test.stems',
      name: 'Test Stems',
      version: '1.0.0',
      model: 'htdemucs'
    }),
    client: () => client,
    input: () => Promise.resolve({ audioPath, trackDir, sampleRateHz: RATE, durationSec: SECONDS }),
    mayRun: () => Promise.resolve(true),
    measure: async (files) =>
      Promise.all(files.map(async (f) => measureStem(f.role, await readFile(f.path)))),
    hash: sha,
    sleep: () => new Promise((r) => setTimeout(r, 1)),
    makeId: () => `job${++id}`,
    ...overrides
  }
  return { stems: createStemHost(deps), store }
}

async function settle(stems: ReturnType<typeof host>['stems'], trackId = TRACK) {
  for (let i = 0; i < 2000; i++) {
    const job = stems.job(trackId)
    if (job && !['queued', 'running'].includes(job.status)) return job
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error('job did not settle')
}

describe('stem host', () => {
  it('splits, validates, measures, and promotes one atomic set', async () => {
    const { client, calls } = fakeClient({ runningPolls: 2 })
    const { stems } = host(client)
    await stems.initialize()
    const queued = await stems.split(TRACK)
    expect(queued.status).toBe('queued')
    expect(queued).not.toHaveProperty('sourceSha256')
    const job = await settle(stems)
    expect(job.status).toBe('done')
    expect(calls.start[0]?.input.audioPath).toBe(audioPath)
    expect(calls.start[0]?.config).toEqual({ backend: 'auto' })

    const sets = await readStemSets(trackDir, TRACK)
    expect(sets).toHaveLength(1)
    const set = sets[0]!
    expect(set.files.map((f) => f.role)).toEqual([
      'stem.vocals',
      'stem.drums',
      'stem.bass',
      'stem.other'
    ])
    expect(set.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true)
    expect(await readdir(join(trackDir, 'stems', 'job1'))).toContain('set.v1.json')
    expect(await readdir(join(trackDir, 'stems', '.staging'))).toEqual([])

    const vocals = set.files.find((f) => f.role === 'stem.vocals')!
    const drums = set.files.find((f) => f.role === 'stem.drums')!
    const bass = set.files.find((f) => f.role === 'stem.bass')!
    expect(vocals.silent).toBe(true)
    expect(vocals.measured).toEqual({})
    expect(drums.measured.bpm?.value).toBeGreaterThan(110)
    expect(drums.measured.bpm?.value).toBeLessThan(130)
    expect(bass.measured.key?.mode).toMatch(/major|minor/)

    const view = toStemSetView(set)
    expect(JSON.stringify(view)).not.toContain('sha256')
    expect(JSON.stringify(view)).not.toContain('.wav')
    expect(view.modelLabel).toBe('Standard')
  })

  it('refuses a staged directory with an undeclared file and keeps nothing', async () => {
    const { client } = fakeClient({ extraFile: true })
    const { stems } = host(client)
    await stems.initialize()
    await stems.split(TRACK)
    const job = await settle(stems)
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/undeclared/)
    expect(await readStemSets(trackDir, TRACK)).toEqual([])
    expect(await readdir(join(trackDir, 'stems', '.staging'))).toEqual([])
  })

  it('refuses stems whose sample rate differs from the track', async () => {
    const { client } = fakeClient({ wrongRate: true })
    const { stems } = host(client)
    await stems.initialize()
    await stems.split(TRACK)
    expect((await settle(stems)).error).toMatch(/sample rate/)
  })

  it('reports a processor error and cleans staging', async () => {
    const { client } = fakeClient({ failWith: 'out of memory' })
    const { stems } = host(client)
    await stems.initialize()
    await stems.split(TRACK)
    const job = await settle(stems)
    expect(job).toMatchObject({ status: 'error', error: 'out of memory' })
  })

  it('cancels a running job through the sidecar and keeps no set', async () => {
    const { client, calls } = fakeClient({ runningPolls: 1_000_000 })
    const { stems } = host(client)
    await stems.initialize()
    await stems.split(TRACK)
    while (stems.job(TRACK)?.status !== 'running') await new Promise((r) => setTimeout(r, 2))
    await stems.cancel(TRACK)
    expect(stems.job(TRACK)?.status).toBe('cancelled')
    expect(calls.cancel).toEqual(['job1'])
    expect(await readStemSets(trackDir, TRACK)).toEqual([])
  })

  it('waits while generation or training holds the GPU', async () => {
    const { client, calls } = fakeClient()
    let idle = false
    const { stems } = host(client, { mayRun: () => Promise.resolve(idle) })
    await stems.initialize()
    await stems.split(TRACK)
    await new Promise((r) => setTimeout(r, 20))
    expect(calls.start).toHaveLength(0)
    expect(stems.job(TRACK)?.status).toBe('queued')
    idle = true
    expect((await settle(stems)).status).toBe('done')
  })

  it('fails when the source changes before separation', async () => {
    const { client } = fakeClient()
    let first = true
    const { stems } = host(client, {
      hash: async (path) => {
        if (first) {
          first = false
          return sha(path)
        }
        return 'f'.repeat(64)
      }
    })
    await stems.initialize()
    await stems.split(TRACK)
    expect((await settle(stems)).error).toMatch(/changed/)
  })

  it('marks jobs interrupted by a restart as failed with a retry hint', async () => {
    const store = createStemStore(join(root, 'stem-jobs.json'))
    await store.load()
    await store.saveJob({
      id: 'old1',
      trackId: TRACK,
      providerId: 'mx.test.stems',
      providerName: 'Test Stems',
      providerVersion: '1.0.0',
      backend: 'auto',
      sourceSha256: 'a'.repeat(64),
      status: 'running',
      progress: 0.4,
      createdAt: 1,
      updatedAt: 1
    })
    await store.settled()
    const { client } = fakeClient()
    const { stems } = host(client)
    await stems.initialize()
    expect(stems.job(TRACK)).toMatchObject({ status: 'error' })
    expect(stems.job(TRACK)?.error).toMatch(/Interrupted/)
  })

  it('a plugin mutation lease stops the active job for that provider', async () => {
    const { client, calls } = fakeClient({ runningPolls: 1_000_000 })
    const { stems } = host(client)
    await stems.initialize()
    await stems.split(TRACK)
    while (stems.job(TRACK)?.status !== 'running') await new Promise((r) => setTimeout(r, 2))
    const release = await stems.acquirePluginMutation('mx.test.stems')
    expect(calls.cancel).toEqual(['job1'])
    expect(stems.job(TRACK)?.status).toBe('cancelled')
    await expect(stems.split(TRACK)).rejects.toThrow(/being updated/)
    await release()
  })

  it('persists settings and refuses a split with no separator', async () => {
    const { client } = fakeClient()
    const { stems } = host(client, { defaultProvider: () => null })
    await stems.initialize()
    await expect(stems.split(TRACK)).rejects.toThrow(/No stem separator/)
    expect(await stems.setSettings({ backend: 'cpu', defaultProvider: 'mx.test.stems' })).toEqual({
      backend: 'cpu',
      defaultProvider: 'mx.test.stems'
    })
    expect(await stems.setSettings({ defaultProvider: '' })).toEqual({ backend: 'cpu' })
  })
})
