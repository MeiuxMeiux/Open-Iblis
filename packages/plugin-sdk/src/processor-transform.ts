// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import type { ParseResult } from './validate.js'

// Processor protocol v2: transforms that write derived audio. It sits beside
// the closed v1 analysis protocol instead of widening it. The host owns the
// source path, a fresh empty staging directory, and every check after the
// job: a processor only returns relative file names inside that directory.
//
//   POST /v2/transform        StemSplitRequestV2 -> TransformAcceptedV2
//   GET  /v2/jobs/:id         -> StemJobStateV2
//   POST /v2/jobs/:id/cancel  -> TransformCancelResponseV2 (after the worker exited)

export const PROCESSOR_TRANSFORM_PROTOCOL_VERSION = 2 as const

export const STEM_ROLES = [
  'stem.vocals',
  'stem.drums',
  'stem.bass',
  'stem.other',
  'stem.guitar',
  'stem.piano'
] as const
export type StemRole = (typeof STEM_ROLES)[number]

export const STEM_BACKENDS = ['auto', 'gpu', 'cpu'] as const
export type StemBackend = (typeof STEM_BACKENDS)[number]

export const MAX_STEM_OUTPUTS = STEM_ROLES.length
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/
const FILE_NAME = /^[a-z][a-z0-9_-]{0,31}\.wav$/

export interface StemSplitRequestV2 {
  protocolVersion: typeof PROCESSOR_TRANSFORM_PROTOCOL_VERSION
  jobId: string
  transform: 'stem-split'
  input: { audioPath: string; sourceSha256: string }
  // Absolute, host-created, empty. Outputs must be plain files directly in it.
  stagingDir: string
  config?: { backend?: StemBackend }
}

export interface StemOutputV2 {
  role: StemRole
  // A bare file name inside stagingDir; never a path.
  path: string
  peakDb: number
  rmsDb: number
}

export interface StemMetricsV2 {
  sampleRate: number
  frames: number
  seconds: number
  residualDb: number
  computeMs: number
}

export type StemJobStateV2 =
  | {
      status: 'queued' | 'running' | 'cancelled'
      progress: number
      stage?: string
      backend?: string
      notice?: string
    }
  | {
      status: 'done'
      progress: 1
      backend?: string
      notice?: string
      stage?: string
      outputs: StemOutputV2[]
      metrics: StemMetricsV2
    }
  | {
      status: 'error'
      progress: number
      error: string
      stage?: string
      backend?: string
      notice?: string
    }

export interface StemHealthV2 {
  model: string
  stems: string[]
  backends: StemBackend[]
}

type JsonObject = Record<string, unknown>

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function shortText(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

export function isTransformJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID.test(value)
}

export function isStemRole(value: unknown): value is StemRole {
  return typeof value === 'string' && (STEM_ROLES as readonly string[]).includes(value)
}

function parseOutput(value: unknown, path: string, errors: string[]): StemOutputV2 | null {
  if (!object(value)) {
    errors.push(`${path}: expected an object`)
    return null
  }
  const { role, path: file, peakDb, rmsDb } = value
  if (!isStemRole(role)) errors.push(`${path}.role: unknown stem role`)
  if (typeof file !== 'string' || !FILE_NAME.test(file)) {
    errors.push(`${path}.path: expected a bare lower-case .wav file name`)
  }
  if (!finiteIn(peakDb, -200, 60)) errors.push(`${path}.peakDb: expected dB in -200..60`)
  if (!finiteIn(rmsDb, -200, 60)) errors.push(`${path}.rmsDb: expected dB in -200..60`)
  if (errors.length) return null
  return {
    role: role as StemRole,
    path: file as string,
    peakDb: peakDb as number,
    rmsDb: rmsDb as number
  }
}

function parseMetrics(value: unknown, errors: string[]): StemMetricsV2 | null {
  if (!object(value)) {
    errors.push('metrics: expected an object')
    return null
  }
  const checks: [keyof StemMetricsV2, number, number][] = [
    ['sampleRate', 8000, 192000],
    ['frames', 1, 192000 * 3600],
    ['seconds', 0, 3600],
    ['residualDb', -200, 60],
    ['computeMs', 0, 7 * 24 * 3600 * 1000]
  ]
  for (const [key, min, max] of checks) {
    if (!finiteIn(value[key], min, max)) errors.push(`metrics.${key}: out of range`)
  }
  return errors.length
    ? null
    : (Object.fromEntries(checks.map(([k]) => [k, value[k]])) as unknown as StemMetricsV2)
}

// Strict, closed parse of a job-state response. Unknown statuses, duplicate
// roles, and non-bare file names are refused; extra diagnostic fields are
// dropped rather than trusted.
export function parseStemJobStateV2(input: unknown, jobId: string): ParseResult<StemJobStateV2> {
  if (!object(input)) return { ok: false, errors: ['state: expected an object'] }
  const errors: string[] = []
  if (input.protocolVersion !== PROCESSOR_TRANSFORM_PROTOCOL_VERSION)
    errors.push('protocolVersion: expected 2')
  if (input.jobId !== jobId) errors.push('jobId: does not match the request')
  if (!finiteIn(input.progress, 0, 1)) errors.push('progress: expected 0..1')
  const extra: { stage?: string; backend?: string; notice?: string } = {}
  for (const key of ['stage', 'backend', 'notice'] as const) {
    const v = input[key]
    if (v === undefined) continue
    if (shortText(v, key === 'notice' ? 500 : 32)) extra[key] = v
    else errors.push(`${key}: expected short text`)
  }
  const progress = input.progress as number
  switch (input.status) {
    case 'queued':
    case 'running':
    case 'cancelled':
      return errors.length
        ? { ok: false, errors }
        : { ok: true, value: { status: input.status, progress, ...extra } }
    case 'error':
      if (!shortText(input.error)) errors.push('error: expected a message')
      return errors.length
        ? { ok: false, errors }
        : { ok: true, value: { status: 'error', progress, error: input.error as string, ...extra } }
    case 'done': {
      const outputs = parseOutputs(input.outputs, errors)
      const metrics = parseMetrics(input.metrics, errors)
      if (errors.length || !outputs || !metrics) return { ok: false, errors }
      return { ok: true, value: { status: 'done', progress: 1, outputs, metrics, ...extra } }
    }
    default:
      errors.push('status: unknown')
      return { ok: false, errors }
  }
}

function parseOutputs(value: unknown, errors: string[]): StemOutputV2[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STEM_OUTPUTS) {
    errors.push(`outputs: expected 1..${MAX_STEM_OUTPUTS} stems`)
    return null
  }
  const outputs: StemOutputV2[] = []
  const roles = new Set<string>()
  const files = new Set<string>()
  value.forEach((candidate, index) => {
    const local: string[] = []
    const out = parseOutput(candidate, `outputs[${index}]`, local)
    errors.push(...local)
    if (!out) return
    if (roles.has(out.role) || files.has(out.path))
      errors.push(`outputs[${index}]: duplicate role or file`)
    roles.add(out.role)
    files.add(out.path)
    outputs.push(out)
  })
  return errors.length ? null : outputs
}

export function parseTransformAcceptedV2(
  input: unknown,
  jobId: string
): ParseResult<{ accepted: true } | { accepted: false; error: string }> {
  if (
    !object(input) ||
    input.protocolVersion !== PROCESSOR_TRANSFORM_PROTOCOL_VERSION ||
    input.jobId !== jobId
  ) {
    return { ok: false, errors: ['accepted: malformed response'] }
  }
  if (input.accepted === true) return { ok: true, value: { accepted: true } }
  if (input.accepted === false && shortText(input.error)) {
    return { ok: true, value: { accepted: false, error: input.error } }
  }
  return { ok: false, errors: ['accepted: malformed response'] }
}

export function parseStemHealthV2(input: unknown): ParseResult<StemHealthV2> {
  if (
    !object(input) ||
    input.ok !== true ||
    input.protocolVersion !== PROCESSOR_TRANSFORM_PROTOCOL_VERSION
  ) {
    return { ok: false, errors: ['health: not a v2 transform processor'] }
  }
  const stems = input.stems
  const backends = input.backends
  if (
    !shortText(input.model, 64) ||
    !Array.isArray(stems) ||
    stems.length === 0 ||
    stems.length > MAX_STEM_OUTPUTS ||
    !stems.every((s) => isStemRole(`stem.${String(s)}`)) ||
    !Array.isArray(backends) ||
    !backends.every((b) => b === 'gpu' || b === 'cpu')
  ) {
    return { ok: false, errors: ['health: malformed stem capabilities'] }
  }
  return {
    ok: true,
    value: { model: input.model, stems: stems as string[], backends: backends as StemBackend[] }
  }
}
