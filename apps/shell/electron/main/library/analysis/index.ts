// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Worker } from 'node:worker_threads'
import type { AudioAnalysis } from '../../../../shared/contract'
import { log } from '../../logger'
import type { TrackRecord } from '../store'
import createAnalysisWorker from './waveform-worker?nodeWorker'
import {
  ANALYSIS_FILENAME,
  decodeAnalysisSidecar,
  encodeAnalysisSidecar,
  type AnalysisSourceIdentity
} from './sidecar'
import { ignoreFailure } from '../../ignore-failure'
import { errorMessage } from '../../error-message'

const WORKER_TIMEOUT_MS = 2 * 60_000

interface WorkerSuccess {
  ok: true
  analysis: AudioAnalysis
  identity: AnalysisSourceIdentity
}

interface WorkerFailure {
  ok: false
  error: string
  code: string
}

interface QueueJob {
  track: TrackRecord
  cancelled: boolean
  resolve: (analysis: AudioAnalysis) => void
  reject: (error: Error) => void
}

const inFlight = new Map<string, Promise<AudioAnalysis>>()
const queue: QueueJob[] = []
const cancelledIds = new Set<string>()
let activeJob: QueueJob | null = null
let activeWorker: Worker | null = null
let shuttingDown = false

function sidecarPath(track: TrackRecord): string {
  return join(dirname(track.filePath), ANALYSIS_FILENAME)
}

function analysisError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function safeFailure(error: unknown, trackId: string): Error {
  const code = String((error as { code?: unknown } | null)?.code ?? 'analysis_failed')
  const messages: Record<string, string> = {
    analysis_cancelled: 'track analysis cancelled',
    analysis_shutdown: 'track analysis is shutting down',
    unsupported_format: 'track format does not support waveform analysis',
    analysis_too_large: 'track is too large for waveform analysis',
    non_finite_sample: 'track contains invalid floating-point samples',
    source_changed: 'track audio changed during analysis'
  }
  if (!messages[code]) log('warn', 'track analysis failed', { trackId, code })
  return analysisError(code, messages[code] ?? 'track analysis unavailable')
}

async function existing(track: TrackRecord): Promise<AudioAnalysis | null> {
  if (track.format.toLowerCase() !== 'wav') return null
  const source = await stat(track.filePath)
  let text: string
  try {
    text = await readFile(sidecarPath(track), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
    throw error
  }
  const analysis = decodeAnalysisSidecar(text, {
    ...(track.audio ? { facts: track.audio } : {}),
    size: source.size,
    mtimeMs: source.mtimeMs
  })
  if (!analysis) {
    log('warn', 'track analysis sidecar invalid; recomputing', { trackId: track.id })
  }
  return analysis
}

function workerMessage(worker: Worker, track: TrackRecord): Promise<WorkerSuccess> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void worker.terminate()
      reject(analysisError('analysis_timeout', `track analysis timed out for ${track.id}`))
    }, WORKER_TIMEOUT_MS)
    worker.once('message', (message: WorkerSuccess | WorkerFailure) => {
      clearTimeout(timeout)
      if (message.ok) resolve(message)
      else reject(analysisError(message.code, 'track analysis worker rejected the audio'))
    })
    worker.once('error', (error: Error) => {
      clearTimeout(timeout)
      reject(analysisError('worker_error', error.message))
    })
    worker.once('exit', (code) => {
      if (code === 0) return
      clearTimeout(timeout)
      reject(analysisError('worker_exit', `track analysis worker exited with code ${code}`))
    })
  })
}

// Cancellation flips the flag from cancelJobs/shutdown while compute awaits;
// reading it through a call keeps each check live across those awaits.
function isCancelled(job: QueueJob): boolean {
  return job.cancelled
}

async function compute(job: QueueJob): Promise<AudioAnalysis> {
  if (isCancelled(job)) throw analysisError('analysis_cancelled', 'track analysis cancelled')
  const worker = createAnalysisWorker({ workerData: { filePath: job.track.filePath } })
  activeWorker = worker
  worker.unref()
  let result: WorkerSuccess
  try {
    result = await workerMessage(worker, job.track)
  } catch (error) {
    if (isCancelled(job)) throw analysisError('analysis_cancelled', 'track analysis cancelled')
    throw error
  } finally {
    await worker.terminate().catch(ignoreFailure)
    if (activeWorker === worker) activeWorker = null
  }
  if (isCancelled(job)) throw analysisError('analysis_cancelled', 'track analysis cancelled')

  const source = await stat(job.track.filePath)
  if (source.size !== result.identity.size || source.mtimeMs !== result.identity.mtimeMs) {
    throw analysisError('source_changed', 'audio changed after analysis')
  }
  const text = encodeAnalysisSidecar(result.analysis, result.identity)
  const validated = decodeAnalysisSidecar(text, {
    ...(job.track.audio ? { facts: job.track.audio } : {}),
    size: source.size,
    mtimeMs: source.mtimeMs
  })
  if (!validated) throw analysisError('invalid_worker_result', 'worker returned invalid analysis')

  const path = sidecarPath(job.track)
  const tmp = `${path}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    const unchanged = await stat(job.track.filePath)
    if (isCancelled(job)) throw analysisError('analysis_cancelled', 'track analysis cancelled')
    if (unchanged.size !== result.identity.size || unchanged.mtimeMs !== result.identity.mtimeMs) {
      throw analysisError('source_changed', 'audio changed before analysis persistence')
    }
    await rename(tmp, path)
    if (isCancelled(job)) {
      await rm(path, { force: true })
      throw analysisError('analysis_cancelled', 'track analysis cancelled')
    }
  } catch (error) {
    await rm(tmp, { force: true }).catch(ignoreFailure)
    if (isCancelled(job)) {
      await rm(path, { force: true }).catch(ignoreFailure)
      throw analysisError('analysis_cancelled', 'track analysis cancelled')
    }
    throw error
  }
  log('info', 'track analysis ready', {
    trackId: job.track.id,
    buckets: validated.peaks.min.length,
    classification: validated.audible.classification,
    peakAmplitude: validated.peakAmplitude,
    rmsAmplitude: validated.rmsAmplitude
  })
  return validated
}

function pump(): void {
  if (activeJob || shuttingDown) return
  const job = queue.shift()
  if (!job) return
  activeJob = job
  void compute(job)
    .then(job.resolve, job.reject)
    .finally(() => {
      if (activeJob === job) activeJob = null
      pump()
    })
}

function enqueue(track: TrackRecord): Promise<AudioAnalysis> {
  return new Promise((resolve, reject) => {
    queue.push({ track, cancelled: false, resolve, reject })
    pump()
  })
}

async function loadOrCompute(track: TrackRecord): Promise<AudioAnalysis> {
  if (track.format.toLowerCase() !== 'wav') {
    throw analysisError('unsupported_format', `analysis does not support ${track.format}`)
  }
  const cached = await existing(track)
  if (cancelledIds.has(track.id)) {
    throw analysisError('analysis_cancelled', 'track analysis cancelled')
  }
  if (cached) return cached
  if (shuttingDown) throw analysisError('analysis_shutdown', 'track analysis is shutting down')
  return enqueue(track)
}

export function ensureTrackAnalysis(track: TrackRecord): Promise<AudioAnalysis> {
  if (cancelledIds.has(track.id)) {
    return Promise.reject(analysisError('analysis_cancelled', 'track analysis cancelled'))
  }
  const current = inFlight.get(track.id)
  if (current) return current
  const promise = loadOrCompute(track)
    .catch((error: unknown) => {
      throw safeFailure(error, track.id)
    })
    .finally(() => {
      if (inFlight.get(track.id) === promise) inFlight.delete(track.id)
    })
  inFlight.set(track.id, promise)
  return promise
}

export function scheduleTrackAnalysis(
  track: TrackRecord,
  onReady?: (analysis: AudioAnalysis) => Promise<void> | void
): void {
  void ensureTrackAnalysis(track)
    .then((analysis) => onReady?.(analysis))
    .catch((error: unknown) => {
      if ((error as { code?: string } | null)?.code === 'analysis_cancelled') return
      log('warn', 'track analysis unavailable', {
        trackId: track.id,
        code: String((error as { code?: unknown } | null)?.code ?? 'analysis_failed'),
        error: errorMessage(error)
      })
    })
}

async function cancelJobs(id: string): Promise<void> {
  for (let index = queue.length - 1; index >= 0; index--) {
    const job = queue[index]
    if (job?.track.id !== id) continue
    queue.splice(index, 1)
    job.cancelled = true
    job.reject(analysisError('analysis_cancelled', 'track analysis cancelled'))
  }
  if (activeJob?.track.id === id) {
    activeJob.cancelled = true
    await activeWorker?.terminate().catch(ignoreFailure)
  }
  await inFlight.get(id)?.catch(ignoreFailure)
}

export async function blockTrackAnalysis(id: string): Promise<void> {
  cancelledIds.add(id)
  await cancelJobs(id)
}

export function releaseTrackAnalysis(id: string): void {
  cancelledIds.delete(id)
}

export async function cancelTrackAnalysis(id: string): Promise<void> {
  await blockTrackAnalysis(id)
  releaseTrackAnalysis(id)
}

export async function shutdownTrackAnalysis(): Promise<void> {
  shuttingDown = true
  for (const job of queue.splice(0)) {
    job.cancelled = true
    job.reject(analysisError('analysis_shutdown', 'track analysis is shutting down'))
  }
  if (activeJob) activeJob.cancelled = true
  await activeWorker?.terminate().catch(ignoreFailure)
  await Promise.allSettled(inFlight.values())
}
