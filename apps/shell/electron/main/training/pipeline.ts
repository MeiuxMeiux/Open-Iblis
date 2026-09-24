// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Multi-stage training orchestration (docs/training/02). The sidecar runs one
// stage at a time and stays stateless between stages; this module owns the
// sequence, durability, cancellation, and the resource lock. All effects are
// injected so the whole state machine is unit-testable.

import {
  type TrainingAdvancedSettings,
  type TrainingCategory,
  type TrainingJobView,
  type TrainingProgressEvent,
  type TrainingStageName,
  type TrainingStageRecord,
  type TrainingVisibility
} from '../../../shared/training'
import {
  recoverTrainingJobs,
  type TrainingDocument,
  type TrainingJobRecord,
  type TrainingStore
} from './store'
import { TrainingStageCancelled, type TrainingSidecarClient } from './sidecar-client'
import { handleStageResult, stageParams } from './stage-io'
import { ignoreFailure } from '../ignore-failure'
import { errorMessage } from '../error-message'

export interface TrainingPipelineDeps {
  store: TrainingStore
  sidecar: {
    ensureRunning(): Promise<void>
    stop(): Promise<void>
    client(): TrainingSidecarClient
  }
  lock: { beginTraining(): Promise<() => Promise<void>> }
  // Balanced thread cap for the trainer (never the max profile — BSOD rule).
  threads(): number
  hashFile(path: string): Promise<{ bytes: number; sha256: string }>
  emitProgress(event: TrainingProgressEvent): void
  emitJobs(jobs: TrainingJobView[]): void
  now?: () => number
  makeId?: () => string
  pollMs?: number
  // Fired when a community job's local stages finish (status awaiting-upload)
  // so the upload flow can take over without the pipeline knowing networks.
  onLocalComplete?(jobId: string): void
  // The 'register' stage of a private job: add the exported adapters to the
  // local Styles library. Required to run a private job.
  registerLocal?(record: TrainingJobRecord): Promise<void>
}

export interface StartJobInput {
  name: string
  trainingId: string
  version: number
  claimToken: string
  categories: TrainingCategory[]
  // Private jobs end after 'register' and never reach the upload flow.
  visibility: TrainingVisibility
  folderPath: string
  scratchDir: string
  folder: { trackCount: number; totalDurationSec: number }
  consent: { publicUploadAcknowledgedAt: number | null; rightsAttestedAt: number }
  // Total VRAM (MB) measured at launch; the pack tiers hyperparameters on it.
  vramTotalMb: number | null
  // Optional power-user overrides; omitted keys stay on the tier auto.
  advanced?: TrainingAdvancedSettings
}

export interface TrainingPipeline {
  init(): Promise<void>
  list(): TrainingJobView[]
  start(input: StartJobInput): Promise<TrainingJobView>
  resume(jobId: string): Promise<TrainingJobView>
  cancel(jobId: string): Promise<void>
  deleteJob(jobId: string): Promise<void>
  activeJobId(): string | null
  updateJob(jobId: string, patch: (job: TrainingJobRecord) => void): Promise<void>
  getRecord(jobId: string): TrainingJobRecord | null
}

const LOCAL_STAGES: TrainingStageName[] = ['scan', 'stems', 'tag', 'dataset']

// A community job hands off to the shell-owned upload and pull-down stages; a
// private job ends with the local 'register' stage instead (D2 as amended).
export function stagePlan(
  categories: TrainingCategory[],
  visibility: TrainingVisibility = 'community'
): TrainingStageRecord[] {
  const names: TrainingStageName[] = [...LOCAL_STAGES]
  if (categories.includes('texture')) names.push('train-texture')
  if (categories.includes('groove')) names.push('train-groove')
  names.push('export')
  if (visibility === 'private') names.push('register')
  else names.push('upload', 'pulldown')
  return names.map((name) => ({ name, status: 'queued', percent: 0 }))
}

// Main-only fields never sent to the renderer (server claim token, local
// paths, upload cursor, launch VRAM).
const MAIN_ONLY_FIELDS = [
  'claimToken',
  'folderPath',
  'scratchDir',
  'uploadedParts',
  'vramTotalMb'
] as const

function toView(record: TrainingJobRecord): TrainingJobView {
  const view = structuredClone(record) as Partial<TrainingJobRecord>
  for (const field of MAIN_ONLY_FIELDS) delete view[field]
  return view as TrainingJobView
}

export function createTrainingPipeline(deps: TrainingPipelineDeps): TrainingPipeline {
  const now = deps.now ?? Date.now
  const makeId =
    deps.makeId ?? (() => `tj-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  let document: TrainingDocument = { version: 1, jobs: [] }
  let saveChain: Promise<void> = Promise.resolve()
  let active: { jobId: string; signal: { cancelled: boolean } } | null = null

  function save(): Promise<void> {
    const snapshot = structuredClone(document)
    saveChain = saveChain.then(() => deps.store.replace(snapshot)).catch(ignoreFailure)
    return saveChain
  }

  function emitJobs(): void {
    deps.emitJobs(document.jobs.map(toView))
  }

  function job(jobId: string): TrainingJobRecord {
    const found = document.jobs.find((candidate) => candidate.id === jobId)
    if (!found) throw new Error(`unknown training job ${jobId}`)
    return found
  }

  async function runJob(record: TrainingJobRecord): Promise<void> {
    const signal = { cancelled: false }
    active = { jobId: record.id, signal }
    const release = await deps.lock.beginTraining()
    try {
      await deps.sidecar.ensureRunning()
      for (const stage of record.stages) {
        if (stage.status === 'done' || stage.status === 'skipped') continue
        // Upload and pull-down are shell-owned network stages; they run from
        // the awaiting-upload state, never inside the local pipeline loop.
        if (stage.name === 'upload' || stage.name === 'pulldown') break
        if (signal.cancelled) throw new TrainingStageCancelled()
        stage.status = 'active'
        stage.startedAt = now()
        stage.percent = 0
        record.updatedAt = now()
        emitJobs()
        void save()
        if (stage.name === 'register') {
          // Shell-owned local stage (private jobs): no sidecar, no network.
          if (!deps.registerLocal) throw new Error('private trainings cannot be registered here')
          await deps.registerLocal(record)
        } else {
          const params = stageParams(record, stage.name, deps.threads())
          const result = await deps.sidecar
            .client()
            .runStage(stage.name, `${record.id}:${stage.name}`, params, {
              pollMs: deps.pollMs,
              signal,
              onProgress: (percent, detail) => {
                stage.percent = percent
                stage.detail = detail
                deps.emitProgress({ jobId: record.id, stage: stage.name, percent, detail })
              }
            })
          await handleStageResult(record, stage.name, result, (path) => deps.hashFile(path))
        }
        stage.status = 'done'
        stage.percent = 100
        stage.finishedAt = now()
        record.updatedAt = now()
        emitJobs()
        await save()
      }
      record.status = record.visibility === 'private' ? 'saved' : 'awaiting-upload'
      record.error = undefined
    } catch (error) {
      const stage = record.stages.find((candidate) => candidate.status === 'active')
      if (error instanceof TrainingStageCancelled || signal.cancelled) {
        record.status = 'cancelled'
        if (stage) {
          stage.status = 'failed'
          stage.error = 'cancelled'
        }
      } else {
        record.status = 'failed'
        record.error = errorMessage(error)
        if (stage) {
          stage.status = 'failed'
          stage.error = record.error
        }
      }
    } finally {
      active = null
      record.updatedAt = now()
      await deps.sidecar.stop().catch(ignoreFailure)
      await release().catch(ignoreFailure)
      emitJobs()
      await save()
    }
    if (record.status === 'awaiting-upload') deps.onLocalComplete?.(record.id)
  }

  return {
    async init() {
      const loaded = await deps.store.load()
      const recovered = recoverTrainingJobs(loaded.document)
      document = recovered.document
      if (recovered.changed || loaded.corrupt) await save()
      emitJobs()
    },

    list() {
      return document.jobs.map(toView)
    },

    async start(input) {
      if (active) throw new Error('a training is already running')
      if (input.categories.length === 0) throw new Error('choose Texture, Groove, or both')
      const record: TrainingJobRecord = {
        id: makeId(),
        name: input.name,
        trainingId: input.trainingId,
        version: input.version,
        claimToken: input.claimToken,
        categories: [...input.categories],
        visibility: input.visibility,
        folder: { ...input.folder },
        consent: { ...input.consent },
        stages: stagePlan(input.categories, input.visibility),
        artifacts: [],
        status: 'running',
        advanced: input.advanced,
        createdAt: now(),
        updatedAt: now(),
        folderPath: input.folderPath,
        scratchDir: input.scratchDir,
        vramTotalMb: input.vramTotalMb
      }
      document.jobs.unshift(record)
      emitJobs()
      await save()
      void runJob(record)
      return toView(record)
    },

    async resume(jobId) {
      if (active) throw new Error('a training is already running')
      const record = job(jobId)
      if (record.status !== 'interrupted' && record.status !== 'failed') {
        throw new Error('only an interrupted or failed training can be resumed')
      }
      for (const stage of record.stages) {
        if (stage.status === 'failed') {
          stage.status = 'queued'
          stage.percent = 0
          stage.error = undefined
        }
      }
      record.status = 'running'
      record.error = undefined
      record.updatedAt = now()
      emitJobs()
      await save()
      void runJob(record)
      return toView(record)
    },

    async cancel(jobId) {
      if (active?.jobId !== jobId) throw new Error('that training is not running')
      // Cooperative: the poll loop notices the flag on its next tick and
      // sends the sidecar cancel for the exact stage id it started.
      active.signal.cancelled = true
    },

    async deleteJob(jobId) {
      if (active?.jobId === jobId) throw new Error('cancel the training before deleting it')
      document.jobs = document.jobs.filter((candidate) => candidate.id !== jobId)
      emitJobs()
      await save()
    },

    activeJobId() {
      return active?.jobId ?? null
    },

    async updateJob(jobId, patch) {
      patch(job(jobId))
      job(jobId).updatedAt = now()
      emitJobs()
      await save()
    },

    getRecord(jobId) {
      return document.jobs.find((candidate) => candidate.id === jobId) ?? null
    }
  }
}
