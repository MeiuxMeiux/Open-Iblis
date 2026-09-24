// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Shell-owned network stages: chunked upload with per-part resume, then the
// status poll and hash-verified pull-down that lands the finished training in
// the local adapter library flagged as yours. Protocol:
// docs/training/03-remote-service.md. Everything is injected for tests.

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { AdapterImportDetails } from '../../../shared/adapters'
import type { TrainingProgressEvent } from '../../../shared/training'
import type { TrainingPipeline } from './pipeline'
import type { TrainingJobRecord } from './store'
import { ignoreFailure } from '../ignore-failure'
import { errorMessage } from '../error-message'

export const PART_BYTES = 8 * 1024 * 1024

export interface UploadFlowDeps {
  pipeline: TrainingPipeline
  request(
    path: string,
    init?: RequestInit
  ): Promise<{ status: number; body: Record<string, unknown> }>
  readSlice(path: string, offset: number, length: number): Promise<Buffer>
  hashFile(path: string): Promise<{ bytes: number; sha256: string }>
  download(source: { url: string; bytes: number; sha256: string }, dest: string): Promise<void>
  registerAdapter(
    sourcePath: string,
    details: AdapterImportDetails & { acknowledgedAt: number }
  ): Promise<unknown>
  tempDir(): Promise<string>
  removeTemp(path: string): Promise<void>
  emitProgress(event: TrainingProgressEvent): void
  publicBase?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
}

interface UploadFile {
  name: string
  path: string
  bytes: number
  sha256: string
}

export interface UploadFlow {
  // Drive an awaiting-upload/uploading job to live (or an honest failure).
  // Idempotent: finished stages are skipped, uploaded parts are not re-sent.
  process(jobId: string): Promise<void>
  retry(jobId: string): Promise<void>
}

export function createUploadFlow(deps: UploadFlowDeps): UploadFlow {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const pollMs = deps.pollMs ?? 60_000
  const publicBase = deps.publicBase ?? 'https://storage.googleapis.com/iblis-dist/'
  const inFlight = new Set<string>()

  async function update(jobId: string, patch: (job: TrainingJobRecord) => void): Promise<void> {
    await deps.pipeline.updateJob(jobId, patch)
  }

  function setStage(
    jobId: string,
    name: 'upload' | 'pulldown',
    patch: {
      status?: 'active' | 'done' | 'failed'
      percent?: number
      detail?: string
      error?: string
    }
  ): Promise<void> {
    return update(jobId, (job) => {
      const stage = job.stages.find((candidate) => candidate.name === name)
      if (!stage) return
      if (patch.status) {
        stage.status = patch.status
        if (patch.status === 'active') stage.startedAt = now()
        if (patch.status === 'done' || patch.status === 'failed') stage.finishedAt = now()
      }
      if (patch.percent !== undefined) stage.percent = patch.percent
      if (patch.detail !== undefined) stage.detail = patch.detail
      if (patch.error !== undefined) stage.error = patch.error
    })
  }

  async function filesFor(record: TrainingJobRecord): Promise<UploadFile[]> {
    const files: UploadFile[] = record.artifacts.map((artifact) => ({
      name: artifact.fileName,
      path: join(record.scratchDir, 'output', artifact.fileName),
      bytes: artifact.bytes,
      sha256: artifact.sha256
    }))
    const metadataPath = join(record.scratchDir, 'output', 'metadata.json')
    const metadata = await deps.hashFile(metadataPath)
    files.push({ name: 'metadata.json', path: metadataPath, ...metadata })
    return files
  }

  async function uploadParts(record: TrainingJobRecord, files: UploadFile[]): Promise<void> {
    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
    let sentBytes = 0
    for (const file of files) {
      const parts = Math.max(1, Math.ceil(file.bytes / PART_BYTES))
      const done = new Set(record.uploadedParts?.[file.name] ?? [])
      sentBytes += done.size * PART_BYTES
      for (let part = 0; part < parts; part++) {
        if (done.has(part)) continue
        const offset = part * PART_BYTES
        const length = Math.min(PART_BYTES, file.bytes - offset)
        const slice = await deps.readSlice(file.path, offset, length)
        if (slice.length !== length) throw new Error(`short read uploading ${file.name}`)
        const sliceSha = createHash('sha256').update(slice).digest('hex')
        const query =
          `upload.php?id=${encodeURIComponent(record.trainingId)}` +
          `&file=${encodeURIComponent(file.name)}&part=${part}&parts=${parts}&sha256=${sliceSha}`
        const { status, body } = await deps.request(query, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Iblis-Claim': record.claimToken
          },
          body: new Uint8Array(slice)
        })
        if (body.ok !== true) {
          throw new Error(String(body.error ?? `upload failed (HTTP ${status})`))
        }
        await update(record.id, (job) => {
          job.uploadedParts ??= {}
          const list = (job.uploadedParts[file.name] ??= [])
          if (!list.includes(part)) list.push(part)
        })
        sentBytes += length
        const percent = Math.min(99, Math.floor((sentBytes / totalBytes) * 100))
        await setStage(record.id, 'upload', {
          percent,
          detail: `Uploading ${file.name} — part ${part + 1} of ${parts}`
        })
        deps.emitProgress({
          jobId: record.id,
          stage: 'upload',
          percent,
          detail: `Uploading ${file.name}`
        })
      }
    }
  }

  async function commit(record: TrainingJobRecord, files: UploadFile[]): Promise<void> {
    const manifest = {
      files: files.map((file) => ({
        name: file.name,
        bytes: file.bytes,
        sha256: file.sha256,
        parts: Math.max(1, Math.ceil(file.bytes / PART_BYTES))
      }))
    }
    const { status, body } = await deps.request('commit.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trainingId: record.trainingId,
        claimToken: record.claimToken,
        manifest
      })
    })
    if (body.ok !== true) {
      const message = String(body.error ?? `commit failed (HTTP ${status})`)
      if (status === 409 && message.includes('missing parts')) {
        // The server disagrees about what arrived: forget our ledger so the
        // next attempt re-sends everything it asks for.
        await update(record.id, (job) => {
          job.uploadedParts = {}
        })
      }
      throw new Error(message)
    }
  }

  async function pollUntilSettled(record: TrainingJobRecord): Promise<'live' | 'rejected'> {
    for (;;) {
      const { status, body } = await deps.request(
        `status.php?id=${encodeURIComponent(record.trainingId)}`
      )
      if (body.ok === true) {
        const state = String(body.status ?? '')
        await update(record.id, (job) => {
          job.serverStatus = state
        })
        if (state === 'live') return 'live'
        if (state === 'rejected' || state === 'flagged' || state === 'removed') {
          const reason = typeof body.reason === 'string' ? body.reason : state
          throw new TrainingRejected(reason)
        }
      } else if (status === 404) {
        throw new TrainingRejected('the server no longer knows this training')
      }
      await setStage(record.id, 'pulldown', {
        detail: 'Waiting for the community library to validate and publish…'
      })
      await sleep(pollMs)
    }
  }

  async function pulldown(record: TrainingJobRecord): Promise<void> {
    const temp = await deps.tempDir()
    try {
      for (const artifact of record.artifacts) {
        const url =
          `${publicBase}trainings/${record.trainingId}/v${record.version}/` + artifact.fileName
        const dest = join(temp, artifact.fileName)
        // The published bytes must equal what we uploaded — same sha256.
        await deps.download({ url, bytes: artifact.bytes, sha256: artifact.sha256 }, dest)
        await deps.registerAdapter(dest, {
          displayName:
            record.artifacts.length > 1 ? `${record.name} (${artifact.category})` : record.name,
          origin: 'yours',
          visibility: 'community',
          trainingId: record.trainingId,
          trainingVersion: record.version,
          claimedBaseModel: 'ACE-Step 1.5',
          sourceUrl: url,
          acknowledgedAt: now()
        })
      }
    } finally {
      await deps.removeTemp(temp).catch(ignoreFailure)
    }
  }

  async function processInner(jobId: string): Promise<void> {
    const record = deps.pipeline.getRecord(jobId)
    if (!record) return
    if (record.status !== 'awaiting-upload' && record.status !== 'uploading') return

    const uploadStage = record.stages.find((stage) => stage.name === 'upload')
    try {
      if (uploadStage?.status !== 'done') {
        await update(jobId, (job) => {
          job.status = 'uploading'
          job.error = undefined
        })
        await setStage(jobId, 'upload', { status: 'active', detail: 'Uploading…' })
        const files = await filesFor(record)
        await uploadParts(record, files)
        await commit(record, files)
        await setStage(jobId, 'upload', { status: 'done', percent: 100 })
        await update(jobId, (job) => {
          job.serverStatus = 'pending'
        })
      } else {
        await update(jobId, (job) => {
          job.status = 'uploading'
        })
      }
    } catch (error) {
      // A failed upload is never silently stranded: the job persists as
      // awaiting-upload with the reason and a visible Retry.
      const message = errorMessage(error)
      await setStage(jobId, 'upload', { status: 'failed', error: message })
      await update(jobId, (job) => {
        job.status = 'awaiting-upload'
        job.error = `Upload failed: ${message}`
      })
      return
    }

    try {
      await setStage(jobId, 'pulldown', { status: 'active', detail: 'Waiting for validation…' })
      await pollUntilSettled(record)
      await setStage(jobId, 'pulldown', {
        percent: 50,
        detail: 'Downloading your published style…'
      })
      await pulldown(record)
      await setStage(jobId, 'pulldown', { status: 'done', percent: 100 })
      await update(jobId, (job) => {
        job.status = 'live'
        job.error = undefined
      })
    } catch (error) {
      const message = errorMessage(error)
      if (error instanceof TrainingRejected) {
        await setStage(jobId, 'pulldown', { status: 'failed', error: message })
        await update(jobId, (job) => {
          job.status = 'failed'
          job.error = `The community library rejected this training: ${message}`
        })
        return
      }
      // Transient network trouble: stay in uploading, resumable on retry or
      // next app start.
      await setStage(jobId, 'pulldown', { error: message, detail: `Retrying: ${message}` })
      await update(jobId, (job) => {
        job.error = undefined
      })
    }
  }

  return {
    async process(jobId) {
      if (inFlight.has(jobId)) return
      inFlight.add(jobId)
      try {
        await processInner(jobId)
      } finally {
        inFlight.delete(jobId)
      }
    },
    async retry(jobId) {
      const record = deps.pipeline.getRecord(jobId)
      if (!record) throw new Error(`unknown training job ${jobId}`)
      if (record.status !== 'awaiting-upload' && record.status !== 'uploading') {
        throw new Error('only a training awaiting upload can retry its upload')
      }
      await update(jobId, (job) => {
        const stage = job.stages.find((candidate) => candidate.name === 'upload')
        if (stage?.status === 'failed') {
          stage.status = 'queued'
          stage.error = undefined
        }
      })
      await this.process(jobId)
    }
  }
}

class TrainingRejected extends Error {}
