// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTrainingStore,
  recoverTrainingJobs,
  type TrainingDocument,
  type TrainingJobRecord
} from '../electron/main/training/store'
import { stagePlan } from '../electron/main/training/pipeline'

const roots: string[] = []

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'iblis-training-store-'))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function job(overrides: Partial<TrainingJobRecord> = {}): TrainingJobRecord {
  return {
    id: 'tj-1',
    name: 'my-style',
    trainingId: 'tr-0123456789abcdef',
    version: 1,
    claimToken: 'c'.repeat(48),
    categories: ['texture'],
    folder: { trackCount: 10, totalDurationSec: 2400 },
    consent: { publicUploadAcknowledgedAt: 1000, rightsAttestedAt: 1000 },
    stages: stagePlan(['texture']),
    artifacts: [],
    status: 'running',
    createdAt: 1000,
    updatedAt: 1000,
    folderPath: '/songs',
    scratchDir: '/scratch/tr-0123456789abcdef',
    ...overrides
  }
}

describe('training store', () => {
  it('persists atomically and reloads the same document', async () => {
    const file = join(await root(), 'jobs.json')
    const store = createTrainingStore(file)
    const document: TrainingDocument = { version: 1, jobs: [job()] }
    await store.replace(document)
    const loaded = await store.load()
    expect(loaded.corrupt).toBe(false)
    expect(loaded.document).toEqual(document)
    // No stray temp files left beside the store.
    expect(readdirSync(join(file, '..')).filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('keeps a private job without a public-upload timestamp, refuses that on community', async () => {
    const store = createTrainingStore(join(await root(), 'jobs.json'))
    const privateJob = job({
      visibility: 'private',
      status: 'saved',
      claimToken: '',
      stages: stagePlan(['texture'], 'private'),
      consent: { publicUploadAcknowledgedAt: null, rightsAttestedAt: 1000 }
    })
    await store.replace({ version: 1, jobs: [privateJob] })
    expect((await store.load()).document.jobs).toEqual([privateJob])

    await store.replace({
      version: 1,
      jobs: [job({ consent: { publicUploadAcknowledgedAt: null, rightsAttestedAt: 1000 } })]
    })
    expect((await store.load()).corrupt).toBe(true)
  })

  it('returns empty for a missing file', async () => {
    const store = createTrainingStore(join(await root(), 'jobs.json'))
    const loaded = await store.load()
    expect(loaded).toEqual({ document: { version: 1, jobs: [] }, corrupt: false })
  })

  it('quarantines a corrupt file instead of guessing', async () => {
    const dir = await root()
    const file = join(dir, 'jobs.json')
    await writeFile(file, '{"version":1,"jobs":[{"broken', 'utf8')
    const store = createTrainingStore(file)
    const loaded = await store.load()
    expect(loaded.corrupt).toBe(true)
    expect(loaded.document.jobs).toEqual([])
    await expect(readFile(`${file}.corrupt`, 'utf8')).resolves.toContain('broken')
  })

  it('rejects a structurally invalid document as corrupt', async () => {
    const dir = await root()
    const file = join(dir, 'jobs.json')
    await writeFile(
      file,
      JSON.stringify({ version: 1, jobs: [{ id: 'x', status: 'nonsense' }] }),
      'utf8'
    )
    const loaded = await createTrainingStore(file).load()
    expect(loaded.corrupt).toBe(true)
  })
})

describe('training crash recovery', () => {
  it('marks a running job interrupted and requeues its active stage', () => {
    const record = job()
    record.stages[1]!.status = 'done'
    record.stages[2]!.status = 'active'
    record.stages[2]!.percent = 40
    const { document, changed } = recoverTrainingJobs({ version: 1, jobs: [record] })
    expect(changed).toBe(true)
    const recovered = document.jobs[0]!
    expect(recovered.status).toBe('interrupted')
    expect(recovered.error).toContain('previous Iblis session')
    expect(recovered.stages[1]!.status).toBe('done')
    expect(recovered.stages[2]!.status).toBe('queued')
    expect(recovered.stages[2]!.percent).toBe(0)
  })

  it('leaves settled jobs untouched', () => {
    const record = job({ status: 'awaiting-upload' })
    const { changed } = recoverTrainingJobs({ version: 1, jobs: [record] })
    expect(changed).toBe(false)
  })
})
