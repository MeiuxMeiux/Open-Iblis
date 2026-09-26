// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Processor protocol v2 client for stem-split sidecars. Every response is
// parsed by the SDK's closed parsers; a malformed answer is an error, never
// a partially trusted state.

import {
  PROCESSOR_TRANSFORM_PROTOCOL_VERSION,
  parseStemHealthV2,
  parseStemJobStateV2,
  parseTransformAcceptedV2,
  type StemHealthV2,
  type StemJobStateV2,
  type StemSplitRequestV2
} from '@iblis/plugin-sdk'

export type Transport = (path: string, init?: RequestInit) => Promise<Response>

export interface StemSidecarClient {
  health(): Promise<StemHealthV2>
  start(request: StemSplitRequestV2): Promise<void>
  state(jobId: string): Promise<StemJobStateV2>
  cancel(jobId: string): Promise<void>
}

const REQUEST_TIMEOUT_MS = 10_000
// Cancel waits for the worker process to exit, which can take a moment while
// a GPU context tears down.
const CANCEL_TIMEOUT_MS = 30_000

async function body(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function json(payload: unknown, timeoutMs = REQUEST_TIMEOUT_MS): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  }
}

export function createStemSidecarClient(transport: Transport): StemSidecarClient {
  return {
    async health() {
      const response = await transport('/health', {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      const parsed = parseStemHealthV2(await body(response))
      if (!response.ok || !parsed.ok)
        throw new Error('stem processor is not a v2 transform sidecar')
      return parsed.value
    },
    async start(request) {
      const response = await transport('/v2/transform', json(request))
      const parsed = parseTransformAcceptedV2(await body(response), request.jobId)
      if (!parsed.ok) throw new Error(`stem processor HTTP ${response.status}`)
      if (!parsed.value.accepted)
        throw new Error(`stem processor refused the job: ${parsed.value.error}`)
    },
    async state(jobId) {
      const response = await transport(`/v2/jobs/${encodeURIComponent(jobId)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (response.status === 404) throw new Error('stem processor lost the job')
      const parsed = parseStemJobStateV2(await body(response), jobId)
      if (!parsed.ok)
        throw new Error(`stem processor returned an invalid state: ${parsed.errors[0]}`)
      return parsed.value
    },
    async cancel(jobId) {
      const response = await transport(
        `/v2/jobs/${encodeURIComponent(jobId)}/cancel`,
        json({ protocolVersion: PROCESSOR_TRANSFORM_PROTOCOL_VERSION }, CANCEL_TIMEOUT_MS)
      )
      if (!response.ok) throw new Error(`stem processor cancel HTTP ${response.status}`)
    }
  }
}
