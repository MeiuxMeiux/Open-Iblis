// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import {
  createTrainingPipeline,
  type TrainingPipelineDeps
} from '../electron/main/training/pipeline'
import {
  createUploadFlow,
  PART_BYTES,
  type UploadFlowDeps
} from '../electron/main/training/upload-flow'
import type { TrainingDocument, TrainingJobRecord } from '../electron/main/training/store'
import { stagePlan } from '../electron/main/training/pipeline'

const ADAPTER_BYTES = PART_BYTES * 2 + 1234 // 3 parts, exercising the boundary
const META_BYTES = 2048

function seedRecord(): TrainingJobRecord {
  const stages = stagePlan(['texture'])
  for (const stage of stages) {
    if (stage.name !== 'upload' && stage.name !== 'pulldown') {
      stage.status = 'done'
      stage.percent = 100
    }
  }
  return {
    id: 'tj-1',
    name: 'my-style',
    trainingId: 'tr-0123456789abcdef',
    version: 1,
    claimToken: 'c'.repeat(48),
    categories: ['texture'],
    folder: { trackCount: 10, totalDurationSec: 2400 },
    consent: { publicUploadAcknowledgedAt: 1, rightsAttestedAt: 1 },
    stages,
    artifacts: [
      {
        category: 'texture',
        fileName: 'adapter_texture.safetensors',
        bytes: ADAPTER_BYTES,
        sha256: 'a'.repeat(64)
      }
    ],
    status: 'awaiting-upload',
    createdAt: 1,
    updatedAt: 1,
    folderPath: '/songs',
    scratchDir: '/scratch/tr-0123456789abcdef'
  }
}

interface ServerOptions {
  failPartOnce?: number
  statusSequence?: string[]
  rejectReason?: string
  commitMissingPartsOnce?: boolean
}

function makeHarness(options: ServerOptions = {}) {
  let document: TrainingDocument = { version: 1, jobs: [seedRecord()] }
  const uploads: { file: string; part: number; bytes: number }[] = []
  const downloads: string[] = []
  const registered: Record<string, unknown>[] = []
  let commits = 0
  let failPartArmed = options.failPartOnce !== undefined
  let missingArmed = options.commitMissingPartsOnce === true
  const statuses = [...(options.statusSequence ?? ['pending', 'live'])]

  const pipelineDeps: TrainingPipelineDeps = {
    store: {
      async load() {
        return { document: structuredClone(document), corrupt: false }
      },
      async replace(next) {
        document = structuredClone(next)
      }
    },
    sidecar: {
      ensureRunning: async () => {},
      stop: async () => {},
      client: () => ({
        props: async () => ({}),
        runStage: async () => ({}),
        cancel: async () => {}
      })
    },
    lock: { beginTraining: async () => async () => {} },
    threads: () => 4,
    hashFile: async (path) =>
      path.endsWith('metadata.json')
        ? { bytes: META_BYTES, sha256: 'b'.repeat(64) }
        : { bytes: ADAPTER_BYTES, sha256: 'a'.repeat(64) },
    emitProgress: () => {},
    emitJobs: () => {}
  }
  const pipeline = createTrainingPipeline(pipelineDeps)

  const deps: UploadFlowDeps = {
    pipeline,
    async request(path, init) {
      if (path.startsWith('upload.php')) {
        const url = new URL(`http://x/${path}`)
        const part = Number(url.searchParams.get('part'))
        const file = String(url.searchParams.get('file'))
        if ((init?.headers as Record<string, string>)['X-Iblis-Claim'] !== 'c'.repeat(48)) {
          return { status: 403, body: { ok: false, error: 'claim does not match' } }
        }
        if (failPartArmed && part === options.failPartOnce) {
          failPartArmed = false
          return { status: 429, body: { ok: false, error: 'slow down' } }
        }
        const bytes = (init?.body as Uint8Array).byteLength
        uploads.push({ file, part, bytes })
        return { status: 200, body: { ok: true, received: bytes, file, part } }
      }
      if (path === 'commit.php') {
        if (missingArmed) {
          missingArmed = false
          return {
            status: 409,
            body: {
              ok: false,
              error: 'adapter_texture.safetensors has missing parts; re-send and commit again'
            }
          }
        }
        commits++
        return { status: 200, body: { ok: true, status: 'pending' } }
      }
      if (path.startsWith('status.php')) {
        const state = statuses.length > 1 ? statuses.shift()! : statuses[0]!
        if (state === 'rejected') {
          return {
            status: 200,
            body: { ok: true, status: 'rejected', version: 1, reason: options.rejectReason }
          }
        }
        return { status: 200, body: { ok: true, status: state, version: 1 } }
      }
      throw new Error(`unexpected request ${path}`)
    },
    readSlice: async (_path, offset, length) => Buffer.alloc(length, 1 + (offset % 250)),
    hashFile: (path) => pipelineDeps.hashFile(path),
    download: async (source) => {
      downloads.push(source.url)
    },
    registerAdapter: async (_path, details) => {
      registered.push({ ...details })
      return {}
    },
    tempDir: async () => '/tmp-test/pulldown',
    removeTemp: async () => {},
    emitProgress: () => {},
    sleep: async () => {},
    pollMs: 1
  }
  const flow = createUploadFlow(deps)
  return {
    pipeline,
    flow,
    uploads,
    downloads,
    registered,
    get commits() {
      return commits
    },
    get document() {
      return document
    }
  }
}

describe('training upload flow', () => {
  it('uploads 8 MiB parts, commits, waits for live, pulls down, and registers yours', async () => {
    const h = makeHarness()
    await h.pipeline.init()
    await h.flow.process('tj-1')
    const job = h.pipeline.list()[0]!
    // 3 adapter parts + 1 metadata part, each within the boundary.
    expect(h.uploads.map((u) => `${u.file}:${u.part}`)).toEqual([
      'adapter_texture.safetensors:0',
      'adapter_texture.safetensors:1',
      'adapter_texture.safetensors:2',
      'metadata.json:0'
    ])
    expect(h.uploads[2]!.bytes).toBe(1234)
    expect(h.commits).toBe(1)
    expect(h.downloads).toEqual([
      'https://storage.googleapis.com/iblis-dist/trainings/tr-0123456789abcdef/v1/adapter_texture.safetensors'
    ])
    expect(h.registered[0]).toMatchObject({
      displayName: 'my-style',
      origin: 'yours',
      trainingId: 'tr-0123456789abcdef',
      trainingVersion: 1
    })
    expect(job.status).toBe('live')
    expect(job.stages.find((s) => s.name === 'upload')?.status).toBe('done')
    expect(job.stages.find((s) => s.name === 'pulldown')?.status).toBe('done')
  })

  it('persists awaiting-upload with the reason on failure and resumes by part', async () => {
    const h = makeHarness({ failPartOnce: 1 })
    await h.pipeline.init()
    await h.flow.process('tj-1')
    let job = h.pipeline.list()[0]!
    expect(job.status).toBe('awaiting-upload')
    expect(job.error).toContain('slow down')
    // Part 0 landed before the failure and must not be re-sent on retry.
    expect(h.uploads.map((u) => u.part)).toEqual([0])

    await h.flow.retry('tj-1')
    job = h.pipeline.list()[0]!
    expect(job.status).toBe('live')
    expect(h.uploads.map((u) => `${u.file}:${u.part}`)).toEqual([
      'adapter_texture.safetensors:0',
      'adapter_texture.safetensors:1',
      'adapter_texture.safetensors:2',
      'metadata.json:0'
    ])
  })

  it('forgets its part ledger when the server reports missing parts at commit', async () => {
    const h = makeHarness({ commitMissingPartsOnce: true })
    await h.pipeline.init()
    await h.flow.process('tj-1')
    expect(h.pipeline.list()[0]!.status).toBe('awaiting-upload')
    await h.flow.retry('tj-1')
    // Every part re-sent after the ledger reset: 4 + 4.
    expect(h.uploads.length).toBe(8)
    expect(h.pipeline.list()[0]!.status).toBe('live')
  })

  it('fails honestly with the server reason when the training is rejected', async () => {
    const h = makeHarness({
      statusSequence: ['pending', 'rejected'],
      rejectReason: 'adapter_texture.safetensors is not a valid safetensors file'
    })
    await h.pipeline.init()
    await h.flow.process('tj-1')
    const job = h.pipeline.list()[0]!
    expect(job.status).toBe('failed')
    expect(job.error).toContain('not a valid safetensors file')
    expect(h.downloads).toEqual([])
  })

  it('refuses to retry a live training', async () => {
    const h = makeHarness()
    await h.pipeline.init()
    await h.flow.process('tj-1')
    await expect(h.flow.retry('tj-1')).rejects.toThrow('awaiting upload')
  })
})
