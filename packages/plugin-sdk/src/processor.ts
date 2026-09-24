// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { scalarKey } from './internal.js'
import type { ParseResult } from './validate.js'

// Versioned processor-sidecar contract. The host owns scheduling, canonical
// track-path resolution, source identity, result validation, and persistence;
// a processor only analyzes the requested immutable bytes.

export const PROCESSOR_PROTOCOL_VERSION = 1 as const

export const PROCESSOR_ANALYSIS_CAPABILITIES = ['bpm-detect', 'key-detect'] as const
export type ProcessorAnalysisCapability = (typeof PROCESSOR_ANALYSIS_CAPABILITIES)[number]

// Enharmonic spellings are normalized before crossing the contract. Keeping a
// single closed spelling for each pitch class makes provider results comparable.
export const CANONICAL_KEY_PITCH_CLASSES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B'
] as const
export type CanonicalKeyPitchClass = (typeof CANONICAL_KEY_PITCH_CLASSES)[number]

export const KEY_MODES = ['major', 'minor'] as const
export type KeyMode = (typeof KEY_MODES)[number]

export const MIN_DETECTED_BPM = 1
export const MAX_DETECTED_BPM = 1000
export const MAX_PROCESSOR_ALTERNATIVES = 8
export const MAX_PROCESSOR_RESULTS = PROCESSOR_ANALYSIS_CAPABILITIES.length

export type ProcessorAnalysisCapabilityBatch =
  ['bpm-detect'] | ['key-detect'] | ['bpm-detect', 'key-detect'] | ['key-detect', 'bpm-detect']

export interface ProcessorTrackInputV1 {
  trackId: string
  // Main resolves and authorizes this canonical path. It never crosses IPC to
  // the renderer and a processor must not use it to infer another path.
  audioPath: string
  // Host-computed identity of the immutable input bytes.
  sourceSha256: string
}

// One process request may ask a provider for both core capabilities so a
// combined detector can decode the source only once.
export interface ProcessorBatchRequestV1 {
  protocolVersion: typeof PROCESSOR_PROTOCOL_VERSION
  jobId: string
  input: ProcessorTrackInputV1
  capabilities: ProcessorAnalysisCapabilityBatch
  config?: Partial<Record<ProcessorAnalysisCapability, Readonly<Record<string, unknown>>>>
}

export interface ProcessorErrorV1 {
  code: string
  message: string
  retryable: boolean
}

export interface ProcessorAcceptedResponseV1 {
  protocolVersion: typeof PROCESSOR_PROTOCOL_VERSION
  jobId: string
  accepted: true
}

export interface ProcessorRejectedResponseV1 {
  protocolVersion: typeof PROCESSOR_PROTOCOL_VERSION
  jobId: string
  accepted: false
  error: ProcessorErrorV1
}

export type ProcessorStartResponseV1 = ProcessorAcceptedResponseV1 | ProcessorRejectedResponseV1

export interface BpmAlternativeV1 {
  bpm: number
  // Null means the implementation does not expose calibrated confidence. A
  // provider and host must never manufacture a confidence value.
  confidence: number | null
}

export interface BpmDetectionValueV1 {
  schemaVersion: 1
  bpm: number
  confidence: number | null
  alternatives: BpmAlternativeV1[]
}

export interface KeyAlternativeV1 {
  pitchClass: CanonicalKeyPitchClass
  mode: KeyMode
  confidence: number | null
}

export interface KeyDetectionValueV1 {
  schemaVersion: 1
  pitchClass: CanonicalKeyPitchClass
  mode: KeyMode
  confidence: number | null
  alternatives: KeyAlternativeV1[]
}

export interface BpmProcessorAnalysisResultV1 {
  capability: 'bpm-detect'
  value: BpmDetectionValueV1
}

export interface KeyProcessorAnalysisResultV1 {
  capability: 'key-detect'
  value: KeyDetectionValueV1
}

export type ProcessorAnalysisResultV1 = BpmProcessorAnalysisResultV1 | KeyProcessorAnalysisResultV1

export type ProcessorAnalysisResultBatchV1 =
  | [BpmProcessorAnalysisResultV1]
  | [KeyProcessorAnalysisResultV1]
  | [BpmProcessorAnalysisResultV1, KeyProcessorAnalysisResultV1]
  | [KeyProcessorAnalysisResultV1, BpmProcessorAnalysisResultV1]

interface ProcessorJobBaseV1 {
  protocolVersion: typeof PROCESSOR_PROTOCOL_VERSION
  jobId: string
}

export type ProcessorJobStateV1 =
  | (ProcessorJobBaseV1 & {
      status: 'queued' | 'running'
      // Wire validators must keep progress finite and inside 0..1.
      progress: number
    })
  | (ProcessorJobBaseV1 & {
      status: 'done'
      progress: 1
      results: ProcessorAnalysisResultBatchV1
    })
  | (ProcessorJobBaseV1 & {
      status: 'error'
      progress: number
      error: ProcessorErrorV1
    })
  | (ProcessorJobBaseV1 & { status: 'cancelled'; progress: number })

// `cancelled: true` is a release-of-input guarantee: the sidecar has stopped
// touching the track before it sends this response. Terminal/unknown jobs are
// explicit so host cancellation can remain idempotent without guessing.
export type ProcessorCancelledResponseV1 =
  | {
      protocolVersion: typeof PROCESSOR_PROTOCOL_VERSION
      jobId: string
      cancelled: true
    }
  | {
      protocolVersion: typeof PROCESSOR_PROTOCOL_VERSION
      jobId: string
      cancelled: false
      reason: 'already-terminal' | 'unknown-job'
    }

type JsonObject = Record<string, unknown>

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(
  value: JsonObject,
  expected: readonly string[],
  path: string,
  errors: string[]
): void {
  const allowed = new Set(expected)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key}: unknown field`)
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: field is required`)
  }
}

function validBpm(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_DETECTED_BPM &&
    value <= MAX_DETECTED_BPM
  )
}

function validConfidence(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)
  )
}

function validateBpmPoint(value: unknown, path: string, errors: string[]): void {
  if (!object(value)) {
    errors.push(`${path}: expected an object`)
    return
  }
  exactKeys(value, ['bpm', 'confidence'], path, errors)
  if (!validBpm(value.bpm)) {
    errors.push(`${path}.bpm: expected a finite value from 1 through 1000`)
  }
  if (!validConfidence(value.confidence)) {
    errors.push(`${path}.confidence: expected null or a finite value from 0 through 1`)
  }
}

function validateAlternatives(
  value: unknown,
  path: string,
  validate: (candidate: unknown, candidatePath: string, errors: string[]) => void,
  identity: (candidate: JsonObject) => string,
  primaryIdentity: string,
  errors: string[]
): void {
  if (!Array.isArray(value) || value.length > MAX_PROCESSOR_ALTERNATIVES) {
    errors.push(`${path}: expected an array of at most ${MAX_PROCESSOR_ALTERNATIVES} alternatives`)
    return
  }
  const seen = new Set([primaryIdentity])
  for (let index = 0; index < value.length; index++) {
    const candidate: unknown = value[index]
    const candidatePath = `${path}[${index}]`
    validate(candidate, candidatePath, errors)
    if (!object(candidate)) continue
    const key = identity(candidate)
    if (seen.has(key)) errors.push(`${candidatePath}: duplicate primary or alternative result`)
    seen.add(key)
  }
}

export function parseBpmDetectionValueV1(
  input: unknown,
  path = 'bpmResult'
): ParseResult<BpmDetectionValueV1> {
  const errors: string[] = []
  if (!object(input)) return { ok: false, errors: [`${path}: expected an object`] }
  exactKeys(input, ['schemaVersion', 'bpm', 'confidence', 'alternatives'], path, errors)
  if (input.schemaVersion !== 1) errors.push(`${path}.schemaVersion: expected 1`)
  if (!validBpm(input.bpm)) {
    errors.push(`${path}.bpm: expected a finite value from 1 through 1000`)
  }
  if (!validConfidence(input.confidence)) {
    errors.push(`${path}.confidence: expected null or a finite value from 0 through 1`)
  }
  validateAlternatives(
    input.alternatives,
    `${path}.alternatives`,
    validateBpmPoint,
    (candidate) => scalarKey(candidate.bpm),
    scalarKey(input.bpm),
    errors
  )
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as BpmDetectionValueV1 }
}

function validPitchClass(value: unknown): value is CanonicalKeyPitchClass {
  return (
    typeof value === 'string' && (CANONICAL_KEY_PITCH_CLASSES as readonly string[]).includes(value)
  )
}

function validMode(value: unknown): value is KeyMode {
  return typeof value === 'string' && (KEY_MODES as readonly string[]).includes(value)
}

function validateKeyPoint(value: unknown, path: string, errors: string[]): void {
  if (!object(value)) {
    errors.push(`${path}: expected an object`)
    return
  }
  exactKeys(value, ['pitchClass', 'mode', 'confidence'], path, errors)
  if (!validPitchClass(value.pitchClass)) {
    errors.push(`${path}.pitchClass: expected a canonical sharp pitch class`)
  }
  if (!validMode(value.mode)) errors.push(`${path}.mode: expected major or minor`)
  if (!validConfidence(value.confidence)) {
    errors.push(`${path}.confidence: expected null or a finite value from 0 through 1`)
  }
}

function keyIdentity(value: JsonObject): string {
  return `${scalarKey(value.pitchClass)}:${scalarKey(value.mode)}`
}

export function parseKeyDetectionValueV1(
  input: unknown,
  path = 'keyResult'
): ParseResult<KeyDetectionValueV1> {
  const errors: string[] = []
  if (!object(input)) return { ok: false, errors: [`${path}: expected an object`] }
  exactKeys(
    input,
    ['schemaVersion', 'pitchClass', 'mode', 'confidence', 'alternatives'],
    path,
    errors
  )
  if (input.schemaVersion !== 1) errors.push(`${path}.schemaVersion: expected 1`)
  if (!validPitchClass(input.pitchClass)) {
    errors.push(`${path}.pitchClass: expected a canonical sharp pitch class`)
  }
  if (!validMode(input.mode)) errors.push(`${path}.mode: expected major or minor`)
  if (!validConfidence(input.confidence)) {
    errors.push(`${path}.confidence: expected null or a finite value from 0 through 1`)
  }
  validateAlternatives(
    input.alternatives,
    `${path}.alternatives`,
    validateKeyPoint,
    keyIdentity,
    keyIdentity(input),
    errors
  )
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as KeyDetectionValueV1 }
}

export function parseProcessorAnalysisResultsV1(
  input: unknown,
  path = 'results'
): ParseResult<ProcessorAnalysisResultBatchV1> {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_PROCESSOR_RESULTS) {
    return {
      ok: false,
      errors: [`${path}: expected 1 through ${MAX_PROCESSOR_RESULTS} analysis results`]
    }
  }
  const errors: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < input.length; index++) {
    const result: unknown = input[index]
    const resultPath = `${path}[${index}]`
    if (!object(result)) {
      errors.push(`${resultPath}: expected an object`)
      continue
    }
    exactKeys(result, ['capability', 'value'], resultPath, errors)
    const capability = result.capability
    if (!(PROCESSOR_ANALYSIS_CAPABILITIES as readonly unknown[]).includes(capability)) {
      errors.push(`${resultPath}.capability: unsupported analysis capability`)
      continue
    }
    if (seen.has(capability as string)) {
      errors.push(`${resultPath}.capability: duplicate analysis capability`)
    }
    seen.add(capability as string)
    const parsed =
      capability === 'bpm-detect'
        ? parseBpmDetectionValueV1(result.value, `${resultPath}.value`)
        : parseKeyDetectionValueV1(result.value, `${resultPath}.value`)
    if (!parsed.ok) errors.push(...parsed.errors)
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as ProcessorAnalysisResultBatchV1 }
}
