// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { EngineError } from './protocol'

export type SidecarFetch = (path: string, init?: RequestInit) => Promise<Response>

export interface LiveTransportJob {
  cancelled: boolean
  aborted?: EngineError
  requestAbort?: AbortController
}

export function createEngineTransport(
  fetch: SidecarFetch,
  now: () => number,
  cancelTimeoutMs: number
): {
  cancelUpstream(engineId: string): Promise<unknown>
  abortRequest(job: LiveTransportJob): void
  request<T>(
    job: LiveTransportJob,
    path: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
    deadline: number,
    label: string
  ): Promise<T>
} {
  async function cancelUpstream(engineId: string): Promise<unknown> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          controller.abort()
          reject(new EngineError('cancel_timeout', 'engine cancel request timed out'))
        },
        Math.max(1, cancelTimeoutMs)
      )
    })
    try {
      return await Promise.race([
        fetch(`/job?id=${encodeURIComponent(engineId)}&cancel=1`, {
          method: 'POST',
          signal: controller.signal
        }),
        timeout
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async function request<T>(
    job: LiveTransportJob,
    path: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>,
    deadline: number,
    label: string
  ): Promise<T> {
    if (job.aborted) throw job.aborted
    if (job.cancelled) throw new EngineError('job_cancelled', `${path} skipped — job stopped`)
    const remaining = deadline - now()
    if (remaining <= 0) throw new EngineError('timeout', `${label} job timed out`)
    const controller = new AbortController()
    job.requestAbort = controller
    let rejectAbort!: (error: EngineError) => void
    const aborted = new Promise<never>((_resolve, reject) => (rejectAbort = reject))
    let timedOut = false
    const onAbort = (): void => {
      if (!timedOut) rejectAbort(new EngineError('request_aborted', 'request aborted'))
    }
    controller.signal.addEventListener('abort', onAbort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          timedOut = true
          reject(new EngineError('timeout', `${label} job timed out`))
          controller.abort()
        },
        Math.max(1, remaining)
      )
    })
    try {
      return await Promise.race([
        fetch(path, { ...init, signal: controller.signal }).then(consume),
        aborted,
        timeout
      ])
    } finally {
      if (timer) clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
      if (job.requestAbort === controller) delete job.requestAbort
    }
  }

  return {
    cancelUpstream,
    abortRequest(job): void {
      job.requestAbort?.abort()
    },
    request
  }
}
