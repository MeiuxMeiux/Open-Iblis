// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// ProcessorSidecarClient adapter for the built-in detectors: the scheduler
// speaks the same start/state/cancel protocol it uses for native sidecars,
// but jobs run in local worker threads. Results pass through the same
// contract validator as sidecar responses, so the persistence guarantees
// are identical for both runtimes.

import type { Worker } from 'node:worker_threads'
import {
  PROCESSOR_PROTOCOL_VERSION,
  parseProcessorAnalysisResultsV1,
  type ProcessorAnalysisResultBatchV1,
  type ProcessorErrorV1,
  type ProcessorJobStateV1
} from '@iblis/plugin-sdk'
import type { ProcessorSidecarClient } from '../client'
import createDetectorWorker from './detector-worker?nodeWorker'
import { ignoreFailure } from '../../ignore-failure'

const JOB_TIMEOUT_MS = 5 * 60_000
const MAX_TRACKED_JOBS = 256

interface BuiltinJob {
  status: 'running' | 'done' | 'error' | 'cancelled'
  results?: ProcessorAnalysisResultBatchV1
  error?: ProcessorErrorV1
  worker: Worker | null
  timer: NodeJS.Timeout | null
  updatedAt: number
}

// Crosses a thread boundary as structured-clone data; fields are checked, not trusted.
interface WorkerMessage {
  ok: boolean
  results?: unknown
  code?: unknown
  message?: unknown
  retryable?: unknown
}

// Module-level: the scheduler constructs a client per call, but job state
// must survive across those instances (a sidecar keeps it in its process).
const jobs = new Map<string, BuiltinJob>()

function finish(jobId: string, patch: Partial<BuiltinJob>): void {
  const job = jobs.get(jobId)
  if (job?.status !== 'running') return
  if (job.timer) clearTimeout(job.timer)
  const worker = job.worker
  jobs.set(jobId, { ...job, ...patch, worker: null, timer: null, updatedAt: Date.now() })
  void worker?.terminate().catch(ignoreFailure)
}

function fail(jobId: string, message: string, retryable: boolean): void {
  finish(jobId, { status: 'error', error: { code: 'detector_failed', message, retryable } })
}

function pruneTerminalJobs(): void {
  if (jobs.size < MAX_TRACKED_JOBS) return
  const terminal = [...jobs.entries()]
    .filter(([, job]) => job.status !== 'running')
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  for (const [id] of terminal.slice(0, terminal.length / 2 + 1)) jobs.delete(id)
}

export function createBuiltinProcessorClient(providerId: string): ProcessorSidecarClient {
  return {
    async start(request) {
      pruneTerminalJobs()
      const worker = createDetectorWorker({
        workerData: {
          providerId,
          audioPath: request.input.audioPath,
          capabilities: request.capabilities
        }
      })
      const timer = setTimeout(
        () => fail(request.jobId, 'analysis timed out', true),
        JOB_TIMEOUT_MS
      )
      jobs.set(request.jobId, {
        status: 'running',
        worker,
        timer,
        updatedAt: Date.now()
      })
      worker.unref()
      worker.once('message', (message: WorkerMessage) => {
        if (!message.ok) {
          const code: unknown = message.code ?? 'detector_failed'
          const detail: unknown = message.message ?? 'built-in detector failed'
          finish(request.jobId, {
            status: 'error',
            error: {
              code: String(code),
              message: String(detail),
              retryable: message.retryable === true
            }
          })
          return
        }
        const parsed = parseProcessorAnalysisResultsV1(message.results)
        if (!parsed.ok) {
          fail(
            request.jobId,
            `detector returned invalid results: ${parsed.errors.join('; ')}`,
            false
          )
          return
        }
        finish(request.jobId, { status: 'done', results: parsed.value })
      })
      worker.once('error', (error: Error) => fail(request.jobId, error.message, true))
      worker.once('exit', (code) => {
        if (code !== 0) fail(request.jobId, `detector worker exited with code ${code}`, true)
      })
    },
    async state(jobId) {
      const job = jobs.get(jobId)
      if (!job) throw new Error('built-in detector job is unknown')
      const base = { protocolVersion: PROCESSOR_PROTOCOL_VERSION, jobId } as const
      if (job.status === 'running') return { ...base, status: 'running', progress: 0 }
      if (job.status === 'cancelled') return { ...base, status: 'cancelled', progress: 0 }
      if (job.status === 'done' && job.results) {
        return { ...base, status: 'done', progress: 1, results: job.results }
      }
      return {
        ...base,
        status: 'error',
        progress: 0,
        error: job.error ?? {
          code: 'detector_failed',
          message: 'built-in detector failed',
          retryable: false
        }
      } satisfies ProcessorJobStateV1
    },
    async cancel(jobId) {
      finish(jobId, { status: 'cancelled' })
    }
  }
}
