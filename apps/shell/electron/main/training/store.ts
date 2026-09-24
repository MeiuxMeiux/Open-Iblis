// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Durable training-job store. Same discipline as the generation queue's
// store: versioned JSON document, atomic temp+rename writes, validate on
// load, quarantine a corrupt file instead of guessing.

import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  TRAINING_CATEGORIES,
  type TrainingJobStatus,
  type TrainingJobView,
  type TrainingStageRecord
} from '../../../shared/training'
import { ignoreFailure } from '../ignore-failure'

// The full main-side record: the renderer view plus the server claim token
// and the on-disk locations. Only views ever cross the IPC boundary.
export interface TrainingJobRecord extends TrainingJobView {
  claimToken: string
  folderPath: string
  scratchDir: string
  // Total VRAM (MB) captured at launch; drives the pack's tier auto-select.
  // Main-only — dropped from the renderer view.
  vramTotalMb?: number | null
  // Per-file part indices already accepted by the server (upload resume).
  uploadedParts?: Record<string, number[]>
}

export interface TrainingDocument {
  version: 1
  jobs: TrainingJobRecord[]
}

const MAX_STORE_BYTES = 4 * 1024 * 1024
const STATUSES: TrainingJobStatus[] = [
  'running',
  'interrupted',
  'awaiting-upload',
  'uploading',
  'live',
  'saved',
  'failed',
  'cancelled'
]
const STAGE_STATUSES = ['queued', 'active', 'done', 'failed', 'skipped']

export interface TrainingStore {
  load(): Promise<{ document: TrainingDocument; corrupt: boolean }>
  replace(document: TrainingDocument): Promise<void>
}

function empty(): TrainingDocument {
  return { version: 1, jobs: [] }
}

function validStage(value: unknown): value is TrainingStageRecord {
  const stage = value as TrainingStageRecord | null | undefined
  return (
    !!stage &&
    typeof stage.name === 'string' &&
    STAGE_STATUSES.includes(stage.status) &&
    typeof stage.percent === 'number'
  )
}

// A record as read back from disk: the whole value and its consent block may
// be absent until validJob() has proven otherwise.
type StoredJob = Omit<TrainingJobRecord, 'consent'> & {
  consent?: TrainingJobRecord['consent'] | null
}

// Parsed JSON may carry anything. Absent visibility is a pre-alpha.52
// community job; only a private job may lack the public-upload timestamp.
function validVisibility(visibility: unknown, publicUploadAt: unknown): boolean {
  if (visibility === 'private') return publicUploadAt === null || typeof publicUploadAt === 'number'
  if (visibility === undefined || visibility === 'community') {
    return typeof publicUploadAt === 'number'
  }
  return false
}

function validJob(value: unknown): value is TrainingJobRecord {
  const job = value as StoredJob | null | undefined
  return (
    !!job &&
    typeof job.id === 'string' &&
    typeof job.name === 'string' &&
    typeof job.trainingId === 'string' &&
    typeof job.claimToken === 'string' &&
    typeof job.folderPath === 'string' &&
    typeof job.scratchDir === 'string' &&
    Number.isSafeInteger(job.version) &&
    Array.isArray(job.categories) &&
    job.categories.every((c) => (TRAINING_CATEGORIES as readonly string[]).includes(c)) &&
    STATUSES.includes(job.status) &&
    Array.isArray(job.stages) &&
    job.stages.every(validStage) &&
    Array.isArray(job.artifacts) &&
    !!job.consent &&
    validVisibility(job.visibility, job.consent.publicUploadAcknowledgedAt) &&
    typeof job.consent.rightsAttestedAt === 'number' &&
    typeof job.createdAt === 'number' &&
    typeof job.updatedAt === 'number'
  )
}

function valid(value: unknown): value is TrainingDocument {
  const doc = value as { version?: unknown; jobs?: unknown } | null | undefined
  return !!doc && doc.version === 1 && Array.isArray(doc.jobs) && doc.jobs.every(validJob)
}

export function createTrainingStore(file: string): TrainingStore {
  return {
    async load() {
      let text: string
      try {
        const handle = await open(file, 'r')
        try {
          const stats = await handle.stat()
          if (stats.size > MAX_STORE_BYTES) throw new Error('training store exceeds the size cap')
          text = await handle.readFile('utf8')
        } finally {
          await handle.close()
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { document: empty(), corrupt: false }
        }
        await rename(file, `${file}.corrupt`).catch(ignoreFailure)
        return { document: empty(), corrupt: true }
      }
      try {
        const parsed: unknown = JSON.parse(text)
        if (!valid(parsed)) throw new Error('invalid training document')
        return { document: parsed, corrupt: false }
      } catch {
        await rename(file, `${file}.corrupt`).catch(ignoreFailure)
        return { document: empty(), corrupt: true }
      }
    },

    async replace(document) {
      const serialized = JSON.stringify(document, null, 1)
      if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
        throw new Error('training store exceeds the size cap')
      }
      await mkdir(dirname(file), { recursive: true })
      const temp = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, serialized, 'utf8')
        await rename(temp, file)
      } catch (error) {
        await rm(temp, { force: true }).catch(ignoreFailure)
        throw error
      }
    }
  }
}

// Crash recovery applied at init: a job the last session left running is
// honestly interrupted; its stages resume from the first not-done stage.
export function recoverTrainingJobs(document: TrainingDocument): {
  document: TrainingDocument
  changed: boolean
} {
  let changed = false
  for (const job of document.jobs) {
    if (job.status !== 'running') continue
    job.status = 'interrupted'
    job.error = 'A previous Iblis session closed while this training was running.'
    for (const stage of job.stages) {
      if (stage.status === 'active') {
        stage.status = 'queued'
        stage.percent = 0
        stage.detail = 'Interrupted — will re-run from this stage.'
      }
    }
    changed = true
  }
  return { document, changed }
}
