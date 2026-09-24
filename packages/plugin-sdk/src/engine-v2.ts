// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

// Engine contract v2 — signed descriptor side (planning packet 2026-07-21,
// 03-engine-contract-v2.md). A v2 engine pack ships a hash-pinned descriptor
// asset declaring its MAXIMUM operation, input, output, control, and adapter
// claims; `GET /v2/descriptor` later reports live installed facts that may
// only narrow them (see engine-v2-jobs.ts). Every shape here is closed:
// unknown fields, unbounded text, and out-of-range numbers fail in the host
// before anything reaches a native process.

import { scalarKey } from './internal.js'
import type { ParseResult } from './validate.js'

export const ENGINE_V2_PROTOCOL_VERSION = 2 as const

export const ENGINE_V2_OPERATION_IDS = [
  'music.generate',
  'music.cover',
  'music.extend',
  'music.inpaint',
  'music.complete',
  'music.add-layer',
  'music.extract-layer'
] as const
export type EngineOperationIdV2 = (typeof ENGINE_V2_OPERATION_IDS)[number]

export const ENGINE_V2_INPUT_ROLES = ['source', 'reference'] as const
export type EngineInputRoleV2 = (typeof ENGINE_V2_INPUT_ROLES)[number]

export const ENGINE_V2_OUTPUT_ROLES = [
  'mix',
  'vocals',
  'accompaniment',
  'layer',
  'residual',
  'preview',
  'metadata'
] as const
export type EngineOutputRoleV2 = (typeof ENGINE_V2_OUTPUT_ROLES)[number]

export const ENGINE_V2_AUDIO_FORMATS = ['wav', 'flac', 'mp3'] as const
export type EngineAudioFormatV2 = (typeof ENGINE_V2_AUDIO_FORMATS)[number]

export const ENGINE_V2_LYRICS_DIALECTS = ['plain', 'ace-structured'] as const
export type EngineLyricsDialectV2 = (typeof ENGINE_V2_LYRICS_DIALECTS)[number]

// Common semantic controls the host renders natively. Anything else an engine
// wants must be a bounded advanced control from the closed kinds below.
export const ENGINE_V2_COMMON_CONTROLS = [
  'negativePrompt',
  'bpm',
  'keyscale',
  'timeSignature'
] as const
export type EngineCommonControlV2 = (typeof ENGINE_V2_COMMON_CONTROLS)[number]

export const ENGINE_V2_CONTROL_KINDS = ['boolean', 'number', 'integer', 'enum'] as const
export const ENGINE_V2_SEED_MODES = ['none', 'uint32'] as const
export type EngineSeedModeV2 = (typeof ENGINE_V2_SEED_MODES)[number]

// Transport/byte ceilings. The descriptor parser receives parsed JSON; the
// transport layer must refuse larger bodies before JSON.parse.
export const MAX_ENGINE_V2_DESCRIPTOR_BYTES = 128 * 1024
export const MAX_ENGINE_V2_OPERATIONS = 16
export const MAX_ENGINE_V2_MODELS = 64
export const MAX_ENGINE_V2_PROFILES = 32
export const MAX_ENGINE_V2_PHASES = 16
export const MAX_ENGINE_V2_INPUTS_PER_OPERATION = 4
export const MAX_ENGINE_V2_OUTPUTS_PER_OPERATION = 8
export const MAX_ENGINE_V2_OUTPUT_COUNT = 9
export const MAX_ENGINE_V2_ADVANCED_CONTROLS = 32
export const MAX_ENGINE_V2_ENUM_VALUES = 16
export const MAX_ENGINE_V2_ADAPTER_FAMILIES = 8
export const MAX_ENGINE_V2_ACTIVE_ADAPTERS = 4
export const MAX_ENGINE_V2_DURATION_SEC = 3600
export const MAX_ENGINE_V2_RANGES = 8
export const MAX_ENGINE_V2_PROMPT_BYTES = 16 * 1024
export const MAX_ENGINE_V2_LYRICS_BYTES = 32 * 1024

const MAX_ID_BYTES = 64
const MAX_LABEL_BYTES = 128
const MAX_HELP_BYTES = 512
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Environment-neutral UTF-8 byte measure: the SDK compiles without Node types.
function utf8Bytes(value: string): number {
  let bytes = 0
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

export interface EngineModelV2 {
  id: string
  revision: string
}

export interface EngineProfileV2 {
  id: string
  label: string
  modelId: string
}

export interface EngineOperationInputV2 {
  role: EngineInputRoleV2
  required: boolean
  formats: EngineAudioFormatV2[]
  maxDurationSec: number
  maxRanges: number
}

export interface EngineOperationOutputV2 {
  role: EngineOutputRoleV2
  maxCount: number
}

export type EngineAdvancedControlV2 =
  | { id: string; label: string; help?: string; kind: 'boolean'; default: boolean }
  | {
      id: string
      label: string
      help?: string
      kind: 'number' | 'integer'
      min: number
      max: number
      default: number
      step?: number
    }
  | { id: string; label: string; help?: string; kind: 'enum'; values: string[]; default: string }

export interface EngineOperationV2 {
  id: EngineOperationIdV2
  inputs: EngineOperationInputV2[]
  prompt: { required: boolean; maxBytes: number } | null
  lyrics: { dialect: EngineLyricsDialectV2; maxBytes: number } | null
  duration: { minSec: number; maxSec: number } | null
  outputs: EngineOperationOutputV2[]
  commonControls: EngineCommonControlV2[]
  advancedControls: EngineAdvancedControlV2[]
  profileIds: string[]
  adapters: { families: string[]; maxActive: number } | null
  seed: EngineSeedModeV2
  cancellation: boolean
}

export interface EngineDescriptorV2 {
  protocolVersion: typeof ENGINE_V2_PROTOCOL_VERSION
  // Scopes adapters, blueprints, and model claims. Two engines share a family
  // only when their artifacts are genuinely interchangeable.
  engineFamily: string
  models: EngineModelV2[]
  profiles: EngineProfileV2[]
  phases: string[]
  operations: EngineOperationV2[]
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
}

function requireKeys(
  value: JsonObject,
  keys: readonly string[],
  path: string,
  errors: string[]
): void {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: field is required`)
  }
}

function validId(value: unknown, maxBytes = MAX_ID_BYTES): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    utf8Bytes(value) <= maxBytes &&
    ID_PATTERN.test(value)
  )
}

function validText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim() === value &&
    utf8Bytes(value) <= maxBytes &&
    // Signed plain text only: no control characters that could smuggle
    // terminal escapes or embedded markup boundaries into the UI.
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function intIn(value: unknown, min: number, max: number): value is number {
  return finiteIn(value, min, max) && Number.isInteger(value)
}

function closed<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function uniqueIds(values: string[], path: string, errors: string[]): void {
  if (new Set(values).size !== values.length) errors.push(`${path}: duplicate ids`)
}

function validateInput(value: unknown, path: string, errors: string[]): void {
  if (!object(value)) {
    errors.push(`${path}: expected an object`)
    return
  }
  exactKeys(value, ['role', 'required', 'formats', 'maxDurationSec', 'maxRanges'], path, errors)
  requireKeys(value, ['role', 'required', 'formats', 'maxDurationSec', 'maxRanges'], path, errors)
  if (!closed(value.role, ENGINE_V2_INPUT_ROLES)) errors.push(`${path}.role: unknown input role`)
  if (typeof value.required !== 'boolean') errors.push(`${path}.required: expected a boolean`)
  const formats = value.formats
  if (
    !Array.isArray(formats) ||
    formats.length === 0 ||
    formats.length > ENGINE_V2_AUDIO_FORMATS.length ||
    !formats.every((format) => closed(format, ENGINE_V2_AUDIO_FORMATS)) ||
    new Set(formats).size !== formats.length
  ) {
    errors.push(`${path}.formats: expected unique formats from the closed set`)
  }
  if (!finiteIn(value.maxDurationSec, 1, MAX_ENGINE_V2_DURATION_SEC)) {
    errors.push(`${path}.maxDurationSec: expected 1 through ${MAX_ENGINE_V2_DURATION_SEC}`)
  }
  if (!intIn(value.maxRanges, 0, MAX_ENGINE_V2_RANGES)) {
    errors.push(`${path}.maxRanges: expected an integer 0 through ${MAX_ENGINE_V2_RANGES}`)
  }
}

function validateOutput(value: unknown, path: string, errors: string[]): void {
  if (!object(value)) {
    errors.push(`${path}: expected an object`)
    return
  }
  exactKeys(value, ['role', 'maxCount'], path, errors)
  requireKeys(value, ['role', 'maxCount'], path, errors)
  if (!closed(value.role, ENGINE_V2_OUTPUT_ROLES)) {
    errors.push(`${path}.role: unknown output role`)
  }
  if (!intIn(value.maxCount, 1, MAX_ENGINE_V2_OUTPUT_COUNT)) {
    errors.push(`${path}.maxCount: expected an integer 1 through ${MAX_ENGINE_V2_OUTPUT_COUNT}`)
  }
}

function validateControl(value: unknown, path: string, errors: string[]): void {
  if (!object(value)) {
    errors.push(`${path}: expected an object`)
    return
  }
  const kind = value.kind
  if (!closed(kind, ENGINE_V2_CONTROL_KINDS)) {
    errors.push(`${path}.kind: unknown control kind`)
    return
  }
  const base = ['id', 'label', 'help', 'kind']
  if (!validId(value.id)) errors.push(`${path}.id: expected a bounded identifier`)
  if (!validText(value.label, MAX_LABEL_BYTES)) {
    errors.push(`${path}.label: expected bounded plain text`)
  }
  if (value.help !== undefined && !validText(value.help, MAX_HELP_BYTES)) {
    errors.push(`${path}.help: expected bounded plain text`)
  }
  if (kind === 'boolean') {
    exactKeys(value, [...base, 'default'], path, errors)
    if (typeof value.default !== 'boolean') errors.push(`${path}.default: expected a boolean`)
    return
  }
  if (kind === 'enum') {
    exactKeys(value, [...base, 'values', 'default'], path, errors)
    const values = value.values
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.length > MAX_ENGINE_V2_ENUM_VALUES ||
      !values.every((entry) => validId(entry, MAX_LABEL_BYTES)) ||
      new Set(values).size !== values.length
    ) {
      errors.push(`${path}.values: expected 1 through ${MAX_ENGINE_V2_ENUM_VALUES} unique values`)
      return
    }
    if (!values.some((entry) => entry === value.default)) {
      errors.push(`${path}.default: expected one of the declared values`)
    }
    return
  }
  exactKeys(value, [...base, 'min', 'max', 'default', 'step'], path, errors)
  const min = value.min
  const max = value.max
  const fallback = value.default
  const bounded =
    finiteIn(min, -1_000_000, 1_000_000) && finiteIn(max, -1_000_000, 1_000_000) && min < max
  if (!bounded) {
    errors.push(`${path}: expected finite min < max within +-1000000`)
    return
  }
  if (!finiteIn(fallback, min, max)) {
    errors.push(`${path}.default: expected a value between min and max`)
  }
  if (value.step !== undefined && !finiteIn(value.step, 1e-6, max - min)) {
    errors.push(`${path}.step: expected a positive step no larger than the range`)
  }
  if (kind === 'integer') {
    for (const field of ['min', 'max', 'default', 'step'] as const) {
      const candidate = value[field]
      if (candidate !== undefined && !Number.isInteger(candidate)) {
        errors.push(`${path}.${field}: expected an integer`)
      }
    }
  }
}

function validateOperation(
  value: unknown,
  path: string,
  profileIds: Set<string>,
  errors: string[]
): void {
  if (!object(value)) {
    errors.push(`${path}: expected an object`)
    return
  }
  const fields = [
    'id',
    'inputs',
    'prompt',
    'lyrics',
    'duration',
    'outputs',
    'commonControls',
    'advancedControls',
    'profileIds',
    'adapters',
    'seed',
    'cancellation'
  ]
  exactKeys(value, fields, path, errors)
  requireKeys(value, fields, path, errors)
  if (!closed(value.id, ENGINE_V2_OPERATION_IDS)) errors.push(`${path}.id: unknown operation id`)

  const inputs = value.inputs
  if (!Array.isArray(inputs) || inputs.length > MAX_ENGINE_V2_INPUTS_PER_OPERATION) {
    errors.push(`${path}.inputs: expected at most ${MAX_ENGINE_V2_INPUTS_PER_OPERATION} inputs`)
  } else {
    inputs.forEach((input, index) => {
      validateInput(input, `${path}.inputs[${index}]`, errors)
    })
    const roles = inputs.filter(object).map((input) => scalarKey(input.role))
    uniqueIds(roles, `${path}.inputs`, errors)
  }

  const prompt = value.prompt
  if (prompt !== null && prompt !== undefined) {
    if (!object(prompt)) {
      errors.push(`${path}.prompt: expected null or an object`)
    } else {
      exactKeys(prompt, ['required', 'maxBytes'], `${path}.prompt`, errors)
      requireKeys(prompt, ['required', 'maxBytes'], `${path}.prompt`, errors)
      if (typeof prompt.required !== 'boolean') {
        errors.push(`${path}.prompt.required: expected a boolean`)
      }
      if (!intIn(prompt.maxBytes, 1, MAX_ENGINE_V2_PROMPT_BYTES)) {
        errors.push(`${path}.prompt.maxBytes: expected 1 through ${MAX_ENGINE_V2_PROMPT_BYTES}`)
      }
    }
  }

  const lyrics = value.lyrics
  if (lyrics !== null && lyrics !== undefined) {
    if (!object(lyrics)) {
      errors.push(`${path}.lyrics: expected null or an object`)
    } else {
      exactKeys(lyrics, ['dialect', 'maxBytes'], `${path}.lyrics`, errors)
      requireKeys(lyrics, ['dialect', 'maxBytes'], `${path}.lyrics`, errors)
      if (!closed(lyrics.dialect, ENGINE_V2_LYRICS_DIALECTS)) {
        errors.push(`${path}.lyrics.dialect: unknown lyrics dialect`)
      }
      if (!intIn(lyrics.maxBytes, 1, MAX_ENGINE_V2_LYRICS_BYTES)) {
        errors.push(`${path}.lyrics.maxBytes: expected 1 through ${MAX_ENGINE_V2_LYRICS_BYTES}`)
      }
    }
  }

  const duration = value.duration
  if (duration !== null && duration !== undefined) {
    if (!object(duration)) {
      errors.push(`${path}.duration: expected null or an object`)
    } else {
      exactKeys(duration, ['minSec', 'maxSec'], `${path}.duration`, errors)
      requireKeys(duration, ['minSec', 'maxSec'], `${path}.duration`, errors)
      const minSec = duration.minSec
      const maxSec = duration.maxSec
      if (
        !finiteIn(minSec, 1, MAX_ENGINE_V2_DURATION_SEC) ||
        !finiteIn(maxSec, 1, MAX_ENGINE_V2_DURATION_SEC) ||
        minSec > maxSec
      ) {
        errors.push(
          `${path}.duration: expected 1 <= minSec <= maxSec <= ${MAX_ENGINE_V2_DURATION_SEC}`
        )
      }
    }
  }

  const outputs = value.outputs
  if (
    !Array.isArray(outputs) ||
    outputs.length === 0 ||
    outputs.length > MAX_ENGINE_V2_OUTPUTS_PER_OPERATION
  ) {
    errors.push(
      `${path}.outputs: expected 1 through ${MAX_ENGINE_V2_OUTPUTS_PER_OPERATION} outputs`
    )
  } else {
    outputs.forEach((output, index) => {
      validateOutput(output, `${path}.outputs[${index}]`, errors)
    })
    uniqueIds(
      outputs.filter(object).map((output) => scalarKey(output.role)),
      `${path}.outputs`,
      errors
    )
  }

  const common = value.commonControls
  if (
    !Array.isArray(common) ||
    common.length > ENGINE_V2_COMMON_CONTROLS.length ||
    !common.every((entry) => closed(entry, ENGINE_V2_COMMON_CONTROLS)) ||
    new Set(common).size !== common.length
  ) {
    errors.push(`${path}.commonControls: expected unique controls from the closed set`)
  }

  const advanced = value.advancedControls
  if (!Array.isArray(advanced) || advanced.length > MAX_ENGINE_V2_ADVANCED_CONTROLS) {
    errors.push(
      `${path}.advancedControls: expected at most ${MAX_ENGINE_V2_ADVANCED_CONTROLS} controls`
    )
  } else {
    advanced.forEach((control, index) => {
      validateControl(control, `${path}.advancedControls[${index}]`, errors)
    })
    uniqueIds(
      advanced.filter(object).map((control) => scalarKey(control.id)),
      `${path}.advancedControls`,
      errors
    )
  }

  const profiles = value.profileIds
  if (
    !Array.isArray(profiles) ||
    profiles.length === 0 ||
    profiles.length > MAX_ENGINE_V2_PROFILES ||
    !profiles.every((id) => typeof id === 'string')
  ) {
    errors.push(`${path}.profileIds: expected 1 through ${MAX_ENGINE_V2_PROFILES} profile ids`)
  } else {
    uniqueIds(profiles, `${path}.profileIds`, errors)
    for (const id of profiles) {
      if (!profileIds.has(id)) errors.push(`${path}.profileIds: ${id} is not a declared profile`)
    }
  }

  const adapters = value.adapters
  if (adapters !== null && adapters !== undefined) {
    if (!object(adapters)) {
      errors.push(`${path}.adapters: expected null or an object`)
    } else {
      exactKeys(adapters, ['families', 'maxActive'], `${path}.adapters`, errors)
      requireKeys(adapters, ['families', 'maxActive'], `${path}.adapters`, errors)
      const families = adapters.families
      if (
        !Array.isArray(families) ||
        families.length === 0 ||
        families.length > MAX_ENGINE_V2_ADAPTER_FAMILIES ||
        !families.every((family) => validId(family)) ||
        new Set(families).size !== families.length
      ) {
        errors.push(
          `${path}.adapters.families: expected 1 through ${MAX_ENGINE_V2_ADAPTER_FAMILIES} unique family ids`
        )
      }
      if (!intIn(adapters.maxActive, 1, MAX_ENGINE_V2_ACTIVE_ADAPTERS)) {
        errors.push(
          `${path}.adapters.maxActive: expected an integer 1 through ${MAX_ENGINE_V2_ACTIVE_ADAPTERS}`
        )
      }
    }
  }

  if (!closed(value.seed, ENGINE_V2_SEED_MODES)) errors.push(`${path}.seed: unknown seed mode`)
  if (typeof value.cancellation !== 'boolean') {
    errors.push(`${path}.cancellation: expected a boolean`)
  }
}

export function parseEngineDescriptorV2(
  input: unknown,
  path = 'descriptor'
): ParseResult<EngineDescriptorV2> {
  const errors: string[] = []
  if (!object(input)) return { ok: false, errors: [`${path}: expected an object`] }
  const fields = ['protocolVersion', 'engineFamily', 'models', 'profiles', 'phases', 'operations']
  exactKeys(input, fields, path, errors)
  requireKeys(input, fields, path, errors)
  if (input.protocolVersion !== ENGINE_V2_PROTOCOL_VERSION) {
    errors.push(`${path}.protocolVersion: expected ${ENGINE_V2_PROTOCOL_VERSION}`)
  }
  if (!validId(input.engineFamily)) {
    errors.push(`${path}.engineFamily: expected a bounded identifier`)
  }

  const models = input.models
  if (!Array.isArray(models) || models.length === 0 || models.length > MAX_ENGINE_V2_MODELS) {
    errors.push(`${path}.models: expected 1 through ${MAX_ENGINE_V2_MODELS} models`)
  } else {
    models.forEach((model, index) => {
      const modelPath = `${path}.models[${index}]`
      if (!object(model)) {
        errors.push(`${modelPath}: expected an object`)
        return
      }
      exactKeys(model, ['id', 'revision'], modelPath, errors)
      requireKeys(model, ['id', 'revision'], modelPath, errors)
      if (!validId(model.id, MAX_LABEL_BYTES)) {
        errors.push(`${modelPath}.id: expected a bounded identifier`)
      }
      if (!validId(model.revision, MAX_LABEL_BYTES)) {
        errors.push(`${modelPath}.revision: expected a bounded identifier`)
      }
    })
    uniqueIds(
      models.filter(object).map((model) => scalarKey(model.id)),
      `${path}.models`,
      errors
    )
  }
  const modelIds = new Set(
    Array.isArray(models) ? models.filter(object).map((model) => scalarKey(model.id)) : []
  )

  const profiles = input.profiles
  if (
    !Array.isArray(profiles) ||
    profiles.length === 0 ||
    profiles.length > MAX_ENGINE_V2_PROFILES
  ) {
    errors.push(`${path}.profiles: expected 1 through ${MAX_ENGINE_V2_PROFILES} profiles`)
  } else {
    profiles.forEach((profile, index) => {
      const profilePath = `${path}.profiles[${index}]`
      if (!object(profile)) {
        errors.push(`${profilePath}: expected an object`)
        return
      }
      exactKeys(profile, ['id', 'label', 'modelId'], profilePath, errors)
      requireKeys(profile, ['id', 'label', 'modelId'], profilePath, errors)
      if (!validId(profile.id)) errors.push(`${profilePath}.id: expected a bounded identifier`)
      if (!validText(profile.label, MAX_LABEL_BYTES)) {
        errors.push(`${profilePath}.label: expected bounded plain text`)
      }
      if (!modelIds.has(scalarKey(profile.modelId))) {
        errors.push(`${profilePath}.modelId: not a declared model`)
      }
    })
    uniqueIds(
      profiles.filter(object).map((profile) => scalarKey(profile.id)),
      `${path}.profiles`,
      errors
    )
  }
  const profileIds = new Set(
    Array.isArray(profiles) ? profiles.filter(object).map((profile) => scalarKey(profile.id)) : []
  )

  const phases = input.phases
  if (
    !Array.isArray(phases) ||
    phases.length === 0 ||
    phases.length > MAX_ENGINE_V2_PHASES ||
    !phases.every((phase) => validId(phase))
  ) {
    errors.push(`${path}.phases: expected 1 through ${MAX_ENGINE_V2_PHASES} phase ids`)
  } else {
    uniqueIds(phases, `${path}.phases`, errors)
  }

  const operations = input.operations
  if (
    !Array.isArray(operations) ||
    operations.length === 0 ||
    operations.length > MAX_ENGINE_V2_OPERATIONS
  ) {
    errors.push(`${path}.operations: expected 1 through ${MAX_ENGINE_V2_OPERATIONS} operations`)
  } else {
    operations.forEach((operation, index) => {
      validateOperation(operation, `${path}.operations[${index}]`, profileIds, errors)
    })
    uniqueIds(
      operations.filter(object).map((operation) => scalarKey(operation.id)),
      `${path}.operations`,
      errors
    )
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as EngineDescriptorV2 }
}
