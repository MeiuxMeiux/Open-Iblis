// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Translation between the host's v1-shaped GenerateRequest (what Create and
// the queue speak today) and a path-free EngineRecipeV2. The v2 driver owns
// this dialect: shared code keeps trafficking in GenerateRequest, and the
// exact recipe the sidecar sees is rebuilt and re-validated here.

import { randomInt } from 'node:crypto'
import {
  ENGINE_V2_PROTOCOL_VERSION,
  engineRecipeErrorsV2,
  parseEngineRecipeV2,
  type EngineAdvancedControlV2,
  type EngineDescriptorV2,
  type EngineOperationV2,
  type EngineRecipeV2,
  type GenerateRequest
} from '@iblis/plugin-sdk'

// Create's v1 surface only expresses prompt-to-music; richer operations
// arrive with the capability UI (roadmap 4D).
const V2_OPERATION = 'music.generate'

const MAX_PROMPT_BYTES = 16 * 1024
const ID_LIKE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Common semantic controls a canonical stored request may carry. Everything
// ACE-specific (steps, solver, models, LM seeds, ...) is profile-derived UI
// scaffolding a v2 engine never sees; it is stripped at admission instead of
// failing a queue the user cannot fix.
const COMMON_KEYS = ['negativePrompt', 'bpm', 'keyscale', 'timeSignature'] as const
const MAX_ADVANCED_ENTRIES = 32
const MAX_ADVANCED_TEXT = 128

type AdvancedValues = Record<string, boolean | number | string>

export function operationOf(descriptor: EngineDescriptorV2): EngineOperationV2 {
  const operation = descriptor.operations.find((candidate) => candidate.id === V2_OPERATION)
  if (!operation) throw new Error(`this engine does not declare ${V2_OPERATION}`)
  return operation
}

// Loose structural gate for an untrusted renderer request, before admission.
export function v2RequestError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'request must be an object'
  const request = value as Partial<GenerateRequest>
  if (typeof request.prompt !== 'string' || request.prompt.trim().length === 0) {
    return 'prompt is required'
  }
  if (Buffer.byteLength(request.prompt, 'utf8') > MAX_PROMPT_BYTES) return 'prompt is too long'
  if (
    typeof request.durationSec !== 'number' ||
    !Number.isFinite(request.durationSec) ||
    request.durationSec < 1 ||
    request.durationSec > 3600
  ) {
    return 'durationSec must be 1 through 3600'
  }
  if (typeof request.preset !== 'string' || request.preset.length > 64) {
    return 'preset must be a short string'
  }
  if (request.seed !== undefined && !isUint32(request.seed)) return 'seed must be a uint32'
  const config: unknown = request.config // untrusted: may be null or a primitive
  if (config !== undefined && (!config || typeof config !== 'object')) {
    return 'config must be an object'
  }
  return null
}

// Strict, descriptor-free canonical shape. The persisted queue store uses
// this to accept rehydrated v2 recipes offline, so it must not need a live
// engine or even an installed one.
export function v2CanonicalRequestError(value: unknown): string | null {
  const loose = v2RequestError(value)
  if (loose) return loose
  const request = value as GenerateRequest
  if (!ID_LIKE.test(request.preset)) return 'preset must be a resolved profile id'
  for (const [key, entry] of Object.entries(request.config ?? {})) {
    if (key === 'advanced') {
      const problem = advancedShapeError(entry)
      if (problem) return problem
      continue
    }
    if (!(COMMON_KEYS as readonly string[]).includes(key)) {
      return `config.${key} is not a v2 engine control`
    }
    if (entry === undefined) continue
    if (key === 'bpm' && !(typeof entry === 'number' && Number.isFinite(entry))) {
      return 'config.bpm must be a number'
    }
    if (key !== 'bpm' && typeof entry !== 'string') return `config.${key} must be a string`
  }
  if (request.lyrics !== undefined && typeof request.lyrics !== 'string') {
    return 'lyrics must be a string'
  }
  return null
}

// Descriptor-free shape gate for stored advanced controls: bounded ids and
// scalar values only. Conformance against the exact descriptor happens at
// admission (resolveAdvanced) and again in buildRecipe.
function advancedShapeError(value: unknown): string | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'config.advanced must be an object'
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_ADVANCED_ENTRIES) return 'config.advanced has too many controls'
  for (const [key, entry] of entries) {
    if (!ID_LIKE.test(key) || key.length > 64) return `config.advanced.${key} is not a control id`
    if (typeof entry === 'boolean') continue
    if (typeof entry === 'number' && Number.isFinite(entry)) continue
    if (typeof entry === 'string' && entry.length <= MAX_ADVANCED_TEXT) continue
    return `config.advanced.${key} must be a boolean, number, or short string`
  }
  return null
}

// Admission for advanced controls: only declared ids survive, every value
// must satisfy the control's own bounds, and an out-of-bounds value is a
// user-fixable refusal rather than a silent clamp.
function resolveAdvanced(
  values: AdvancedValues | undefined,
  controls: EngineAdvancedControlV2[]
): AdvancedValues | undefined {
  if (!values) return undefined
  const resolved: AdvancedValues = {}
  for (const control of controls) {
    const value = values[control.id]
    if (value === undefined) continue
    const problem = controlValueError(control, value)
    if (problem) throw new Error(`${control.label}: ${problem}`)
    resolved[control.id] = value
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined
}

function controlValueError(
  control: EngineAdvancedControlV2,
  value: boolean | number | string
): string | null {
  switch (control.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be on or off'
    case 'enum':
      return typeof value === 'string' && control.values.includes(value)
        ? null
        : `must be one of ${control.values.join(', ')}`
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number'
      if (control.kind === 'integer' && !Number.isInteger(value)) return 'must be a whole number'
      if (value < control.min || value > control.max) {
        return `must be ${control.min} through ${control.max}`
      }
      return null
    }
  }
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff
}

// Admission: the one place omitted defaults and random seeds become concrete.
// Styles cannot silently vanish — an adapter selection on an engine with no
// adapter ingress is refused with an actionable message instead.
export function resolveV2Request(
  request: GenerateRequest,
  descriptor: EngineDescriptorV2
): GenerateRequest {
  const operation = operationOf(descriptor)
  if (request.config?.adapter) {
    throw new Error('this engine does not support styles — clear the style and try again')
  }
  if (request.lyrics !== undefined && operation.lyrics === null) {
    throw new Error('this engine does not support lyrics — clear the lyrics and try again')
  }
  const preset =
    request.preset && operation.profileIds.includes(request.preset)
      ? request.preset
      : operation.profileIds[0]
  if (!preset) throw new Error('this engine declares no usable profile')
  const config: NonNullable<GenerateRequest['config']> = {}
  for (const key of COMMON_KEYS) {
    if (!operation.commonControls.includes(key)) continue
    const value = request.config?.[key]
    if (value !== undefined) (config as Record<string, unknown>)[key] = value
  }
  const advanced = resolveAdvanced(request.config?.advanced, operation.advancedControls)
  if (advanced) config.advanced = advanced
  const seed =
    operation.seed === 'uint32'
      ? request.seed !== undefined && isUint32(request.seed)
        ? request.seed
        : randomInt(0, 0x1_0000_0000)
      : undefined
  const duration = operation.duration
  if (
    duration &&
    (request.durationSec < duration.minSec || request.durationSec > duration.maxSec)
  ) {
    throw new Error(
      `this engine renders ${duration.minSec} through ${duration.maxSec} seconds — adjust the length`
    )
  }
  return {
    prompt: request.prompt,
    durationSec: request.durationSec,
    preset,
    ...(seed !== undefined ? { seed } : {}),
    ...(Object.keys(config).length > 0 ? { config } : {})
  }
}

export interface RecipeContext {
  providerId: string
  pluginVersion: string
  descriptorHash: string
  descriptor: EngineDescriptorV2
}

// Build and doubly validate the exact wire recipe from a canonical request.
export function buildRecipe(request: GenerateRequest, context: RecipeContext): EngineRecipeV2 {
  const operation = operationOf(context.descriptor)
  const common: Record<string, unknown> = {}
  for (const key of COMMON_KEYS) {
    const value = request.config?.[key]
    if (value !== undefined) common[key] = value
  }
  const candidate: Record<string, unknown> = {
    protocolVersion: ENGINE_V2_PROTOCOL_VERSION,
    operation: V2_OPERATION,
    providerId: context.providerId,
    pluginVersion: context.pluginVersion,
    descriptorHash: context.descriptorHash,
    profileId: request.preset,
    prompt: request.prompt,
    inputs: [],
    ...(operation.duration ? { targetDurationSec: request.durationSec } : {}),
    ...(Object.keys(common).length > 0 ? { common } : {}),
    ...(request.config?.advanced ? { advanced: request.config.advanced } : {}),
    ...(request.seed !== undefined && operation.seed === 'uint32' ? { seed: request.seed } : {})
  }
  const parsed = parseEngineRecipeV2(candidate)
  if (!parsed.ok) throw new Error(`engine recipe rejected: ${parsed.errors[0]}`)
  const conformance = engineRecipeErrorsV2(parsed.value, context.descriptor)
  if (conformance.length > 0) throw new Error(`engine recipe rejected: ${conformance[0]}`)
  return parsed.value
}
