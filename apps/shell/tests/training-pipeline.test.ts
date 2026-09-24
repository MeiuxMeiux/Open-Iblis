// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import {
  createTrainingPipeline,
  stagePlan,
  type StartJobInput,
  type TrainingPipelineDeps
} from '../electron/main/training/pipeline'
import { TrainingStageCancelled } from '../electron/main/training/sidecar-client'
import type { TrainingDocument } from '../electron/main/training/store'

interface StageRun {
  stage: string
  params: Record<string, unknown>
}

interface HarnessOptions {
  failStage?: string
  cancelAtStage?: string
  seed?: TrainingDocument
}

function harness(options: HarnessOptions = {}) {
  let document: TrainingDocument = options.seed ?? { version: 1, jobs: [] }
  const runs: StageRun[] = []
  const events: string[] = []
  let locked = 0
  let released = 0
  let sidecarRunning = false
  let sidecarStops = 0
  const registered: string[] = []
  const handedOff: string[] = []

  const deps: TrainingPipelineDeps = {
    store: {
      async load() {
        return { document: structuredClone(document), corrupt: false }
      },
      async replace(next) {
        document = structuredClone(next)
      }
    },
    sidecar: {
      async ensureRunning() {
        sidecarRunning = true
      },
      async stop() {
        sidecarRunning = false
        sidecarStops++
      },
      client: () => ({
        async props() {
          return {}
        },
        async runStage(stage, _jobId, params, opts) {
          runs.push({ stage, params })
          if (opts?.signal?.cancelled || options.cancelAtStage === stage) {
            throw new TrainingStageCancelled()
          }
          if (options.failStage === stage) throw new Error(`${stage} exploded`)
          opts?.onProgress?.(50, `${stage} halfway`)
          if (stage === 'scan') return { trackCount: 12, totalDurationSec: 3000, skipped: [] }
          if (stage === 'export') {
            return {
              files: [{ name: 'adapter_texture.safetensors' }, { name: 'metadata.json' }]
            }
          }
          return {}
        },
        async cancel() {}
      })
    },
    lock: {
      async beginTraining() {
        locked++
        return async () => {
          released++
        }
      }
    },
    threads: () => 6,
    hashFile: async (path) => ({
      bytes: 42_000_000,
      sha256: `hash-of-${path.split(/[\\/]/).pop()}`
    }),
    emitProgress: (event) => events.push(`${event.stage}:${event.percent}`),
    emitJobs: () => {},
    registerLocal: async (record) => {
      registered.push(record.id)
    },
    onLocalComplete: (jobId) => handedOff.push(jobId),
    now: (() => {
      let tick = 1000
      return () => ++tick
    })(),
    makeId: (() => {
      let n = 0
      return () => `tj-${++n}`
    })(),
    pollMs: 1
  }

  const pipeline = createTrainingPipeline(deps)
  const state = {
    pipeline,
    runs,
    events,
    registered,
    handedOff,
    get document() {
      return document
    },
    get locked() {
      return locked
    },
    get released() {
      return released
    },
    get sidecarRunning() {
      return sidecarRunning
    },
    get sidecarStops() {
      return sidecarStops
    }
  }
  return state
}

const input: StartJobInput = {
  name: 'my-style',
  trainingId: 'tr-0123456789abcdef',
  version: 1,
  claimToken: 'c'.repeat(48),
  categories: ['texture'],
  visibility: 'community',
  folderPath: '/songs',
  scratchDir: '/scratch/tr-0123456789abcdef',
  folder: { trackCount: 0, totalDurationSec: 0 },
  consent: { publicUploadAcknowledgedAt: 1, rightsAttestedAt: 1 },
  vramTotalMb: 8192
}

async function settle(h: ReturnType<typeof harness>, jobId: string): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    const job = h.pipeline.list().find((j) => j.id === jobId)
    if (job && job.status !== 'running') return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('job never settled')
}

describe('training pipeline', () => {
  it('runs local stages in order and lands in awaiting-upload with measured artifacts', async () => {
    const h = harness()
    await h.pipeline.init()
    const view = await h.pipeline.start(input)
    await settle(h, view.id)
    const job = h.pipeline.list()[0]!
    expect(h.runs.map((run) => run.stage)).toEqual([
      'scan',
      'stems',
      'tag',
      'dataset',
      'train-texture',
      'export'
    ])
    expect(job.status).toBe('awaiting-upload')
    expect(job.folder).toEqual({ trackCount: 12, totalDurationSec: 3000 })
    expect(job.artifacts).toEqual([
      {
        category: 'texture',
        fileName: 'adapter_texture.safetensors',
        bytes: 42_000_000,
        sha256: 'hash-of-adapter_texture.safetensors'
      }
    ])
    // Upload/pulldown stay queued for the network slice.
    expect(job.stages.find((s) => s.name === 'upload')?.status).toBe('queued')
    // Lock and sidecar are always restored.
    expect(h.locked).toBe(1)
    expect(h.released).toBe(1)
    expect(h.sidecarRunning).toBe(false)
    // The renderer never sees the claim token or paths.
    expect(JSON.stringify(job)).not.toContain('claimToken')
    expect(JSON.stringify(job)).not.toContain('/songs')
  })

  it('keeps the keyed community path: hands off to the upload flow, never registers', async () => {
    const h = harness()
    await h.pipeline.init()
    const view = await h.pipeline.start(input)
    await settle(h, view.id)
    const job = h.pipeline.list()[0]!
    expect(job.visibility).toBe('community')
    expect(job.status).toBe('awaiting-upload')
    expect(h.handedOff).toEqual([view.id])
    expect(h.registered).toEqual([])
  })

  it('runs a private training to the local Styles library without any upload stage', async () => {
    const h = harness()
    await h.pipeline.init()
    const view = await h.pipeline.start({
      ...input,
      trainingId: 'local-0123456789abcdef',
      claimToken: '',
      visibility: 'private',
      consent: { publicUploadAcknowledgedAt: null, rightsAttestedAt: 1 }
    })
    await settle(h, view.id)
    const job = h.pipeline.list()[0]!
    expect(job.stages.map((stage) => stage.name)).toEqual([
      'scan',
      'stems',
      'tag',
      'dataset',
      'train-texture',
      'export',
      'register'
    ])
    expect(job.stages.every((stage) => stage.status === 'done')).toBe(true)
    expect(job.status).toBe('saved')
    expect(job.visibility).toBe('private')
    expect(h.registered).toEqual([view.id])
    // A private job never reaches the upload flow.
    expect(h.handedOff).toEqual([])
    // The consent record persists with no public-upload acknowledgement.
    expect(h.document.jobs[0]?.consent.publicUploadAcknowledgedAt).toBeNull()
  })

  it('plans both trainings successively when both categories are chosen', () => {
    expect(stagePlan(['texture', 'groove']).map((stage) => stage.name)).toEqual([
      'scan',
      'stems',
      'tag',
      'dataset',
      'train-texture',
      'train-groove',
      'export',
      'upload',
      'pulldown'
    ])
  })

  it('fails honestly, releases the lock, and stops the sidecar when a stage errors', async () => {
    const h = harness({ failStage: 'stems' })
    await h.pipeline.init()
    const view = await h.pipeline.start(input)
    await settle(h, view.id)
    const job = h.pipeline.list()[0]!
    expect(job.status).toBe('failed')
    expect(job.error).toContain('stems exploded')
    expect(job.stages.find((s) => s.name === 'stems')?.status).toBe('failed')
    expect(h.released).toBe(1)
    expect(h.sidecarStops).toBe(1)
  })

  it('cancel lands the job in cancelled and still restores everything', async () => {
    const h = harness({ cancelAtStage: 'tag' })
    await h.pipeline.init()
    const view = await h.pipeline.start(input)
    await settle(h, view.id)
    const job = h.pipeline.list()[0]!
    expect(job.status).toBe('cancelled')
    expect(h.released).toBe(1)
    expect(h.sidecarStops).toBe(1)
  })

  it('refuses a second concurrent training', async () => {
    const h = harness({ failStage: 'scan' })
    await h.pipeline.init()
    const view = await h.pipeline.start(input)
    await expect(h.pipeline.start({ ...input, name: 'other' })).rejects.toThrow('already running')
    await settle(h, view.id)
  })

  it('resume re-runs from the first unfinished stage', async () => {
    const h = harness({ failStage: 'dataset' })
    await h.pipeline.init()
    const view = await h.pipeline.start(input)
    await settle(h, view.id)
    expect(h.pipeline.list()[0]!.status).toBe('failed')
    expect(h.runs.length).toBeGreaterThan(0)

    // Rebuild over the same document with the failure healed — mirrors an
    // app restart followed by the user pressing Resume. Done stages must
    // not re-run.
    const healed = harness({ seed: structuredClone(h.document) })
    await healed.pipeline.init()
    await healed.pipeline.resume(view.id)
    await settle(healed, view.id)
    const job = healed.pipeline.list()[0]!
    expect(job.status).toBe('awaiting-upload')
    expect(healed.runs.map((run) => run.stage)).toEqual(['dataset', 'train-texture', 'export'])
  })
})
