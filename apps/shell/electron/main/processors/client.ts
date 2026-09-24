// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  PROCESSOR_PROTOCOL_VERSION,
  parseProcessorAnalysisResultsV1,
  type ProcessorBatchRequestV1,
  type ProcessorErrorV1,
  type ProcessorJobStateV1
} from '@iblis/plugin-sdk'

export interface ProcessorSidecarClient {
  start(request: ProcessorBatchRequestV1): Promise<void>
  state(jobId: string): Promise<ProcessorJobStateV1>
  cancel(jobId: string): Promise<void>
}

type Transport = (path: string, init?: RequestInit) => Promise<Response>

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function errorOf(value: unknown): ProcessorErrorV1 {
  const input = object(value)
  if (
    !input ||
    typeof input.code !== 'string' ||
    typeof input.message !== 'string' ||
    typeof input.retryable !== 'boolean'
  ) {
    return {
      code: 'invalid_response',
      message: 'processor returned an invalid error',
      retryable: false
    }
  }
  return { code: input.code, message: input.message, retryable: input.retryable }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const value = object(await response.json().catch(() => null))
  if (!response.ok || !value) throw new Error(`processor sidecar HTTP ${response.status}`)
  return value
}

function stateOf(value: Record<string, unknown>, jobId: string): ProcessorJobStateV1 {
  if (value.protocolVersion !== PROCESSOR_PROTOCOL_VERSION || value.jobId !== jobId) {
    throw new Error('processor returned a mismatched protocol or job id')
  }
  const progress = value.progress
  if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error('processor returned invalid progress')
  }
  if (value.status === 'queued' || value.status === 'running') {
    return { protocolVersion: PROCESSOR_PROTOCOL_VERSION, jobId, status: value.status, progress }
  }
  if (value.status === 'cancelled') {
    return { protocolVersion: PROCESSOR_PROTOCOL_VERSION, jobId, status: 'cancelled', progress }
  }
  if (value.status === 'error') {
    return {
      protocolVersion: PROCESSOR_PROTOCOL_VERSION,
      jobId,
      status: 'error',
      progress,
      error: errorOf(value.error)
    }
  }
  if (value.status === 'done' && progress === 1) {
    const parsed = parseProcessorAnalysisResultsV1(value.results)
    if (!parsed.ok)
      throw new Error(`processor returned invalid results: ${parsed.errors.join('; ')}`)
    return {
      protocolVersion: PROCESSOR_PROTOCOL_VERSION,
      jobId,
      status: 'done',
      progress: 1,
      results: parsed.value
    }
  }
  throw new Error('processor returned an invalid job state')
}

export function createProcessorSidecarClient(request: Transport): ProcessorSidecarClient {
  return {
    async start(input) {
      const response = await json(
        await request('/v1/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        })
      )
      if (
        response.protocolVersion !== PROCESSOR_PROTOCOL_VERSION ||
        response.jobId !== input.jobId
      ) {
        throw new Error('processor rejected a mismatched protocol or job id')
      }
      if (response.accepted === true) return
      if (response.accepted === false)
        throw Object.assign(new Error(errorOf(response.error).message), errorOf(response.error))
      throw new Error('processor returned an invalid start response')
    },
    async state(jobId) {
      return stateOf(await json(await request(`/v1/jobs/${encodeURIComponent(jobId)}`)), jobId)
    },
    async cancel(jobId) {
      const response = await json(
        await request(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' })
      )
      if (response.protocolVersion !== PROCESSOR_PROTOCOL_VERSION || response.jobId !== jobId) {
        throw new Error('processor cancellation response did not match the job')
      }
      if (
        response.cancelled === true ||
        response.reason === 'already-terminal' ||
        response.reason === 'unknown-job'
      )
        return
      throw new Error('processor returned an invalid cancellation response')
    }
  }
}
