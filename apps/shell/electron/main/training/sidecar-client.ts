// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Typed client for the training pack's loopback sidecar (iblis-train-server,
// docs/training/01 "Sidecar contract"). The transport and lifecycle are
// injected so the pipeline is unit-testable without a real Python process.

import { ignoreFailure } from '../ignore-failure'

type TrainingStagePollState = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

interface TrainingStagePoll {
  state: TrainingStagePollState
  stage?: string
  percent?: number
  detail?: string
  error?: { code: string; message: string }
  result?: unknown
}

// A JSON leaf reported by the sidecar: untrusted, so never assumed well-typed.
export type SidecarScalar = string | number | boolean | null

export interface TrainingSidecarTransport {
  request(path: string, init?: RequestInit): Promise<Response>
}

interface StageRunOptions {
  onProgress?(percent: number, detail: string): void
  pollMs?: number
  signal?: { cancelled: boolean }
}

export interface TrainingSidecarClient {
  props(): Promise<Record<string, unknown>>
  runStage(
    stage: string,
    jobId: string,
    params: Record<string, unknown>,
    options?: StageRunOptions
  ): Promise<unknown>
  cancel(jobId: string): Promise<void>
}

const DEFAULT_POLL_MS = 1000

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {
      /* status alone */
    }
    throw new Error(`training sidecar refused: ${detail}`)
  }
  return (await response.json()) as Record<string, unknown>
}

export function createTrainingSidecarClient(
  transport: TrainingSidecarTransport,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): TrainingSidecarClient {
  return {
    async props() {
      return readJson(await transport.request('/props'))
    },

    async runStage(stage, jobId, params, options = {}) {
      await readJson(
        await transport.request('/job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage, jobId, params })
        })
      )
      const pollMs = options.pollMs ?? DEFAULT_POLL_MS
      for (;;) {
        await sleep(pollMs)
        if (options.signal?.cancelled) {
          await this.cancel(jobId)
        }
        const poll = (await readJson(
          await transport.request(`/job?id=${encodeURIComponent(jobId)}`)
        )) as unknown as TrainingStagePoll
        if (poll.state === 'running') {
          options.onProgress?.(
            Math.max(0, Math.min(100, poll.percent ?? 0)),
            poll.detail ?? 'Working…'
          )
          continue
        }
        if (poll.state === 'done') return poll.result
        if (poll.state === 'cancelled') throw new TrainingStageCancelled()
        throw new Error(poll.error?.message ?? `training stage ${stage} failed`)
      }
    },

    async cancel(jobId) {
      await transport
        .request(`/job?id=${encodeURIComponent(jobId)}&cancel=1`, { method: 'POST' })
        .catch(ignoreFailure)
    }
  }
}

export class TrainingStageCancelled extends Error {
  constructor() {
    super('the training stage was cancelled')
    this.name = 'TrainingStageCancelled'
  }
}
