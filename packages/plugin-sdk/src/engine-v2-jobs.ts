// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

// Engine contract v2 — runtime side: the path-free host recipe, normalized
// job states, staged output declarations, and the signed-versus-live
// descriptor narrowing rule. Counterpart to engine-v2.ts (descriptor side).
// Everything a sidecar reports is treated as hostile until these parsers and
// the host's own file revalidation accept it.

import { scalarKey, trimmedByWindows } from './internal.js'
import type { ParseResult } from './validate.js'
import {
  ENGINE_V2_INPUT_ROLES,
  ENGINE_V2_OPERATION_IDS,
  ENGINE_V2_OUTPUT_ROLES,
  ENGINE_V2_PROTOCOL_VERSION,
  MAX_ENGINE_V2_ACTIVE_ADAPTERS,
  MAX_ENGINE_V2_DURATION_SEC,
  MAX_ENGINE_V2_LYRICS_BYTES,
  MAX_ENGINE_V2_PROMPT_BYTES,
  MAX_ENGINE_V2_RANGES,
  type EngineAdvancedControlV2,
  type EngineDescriptorV2,
  type EngineInputRoleV2,
  type EngineOperationIdV2,
  type EngineOperationV2,
  type EngineOutputRoleV2
} from './engine-v2.js'

export const MAX_ENGINE_V2_RECIPE_BYTES = 48 * 1024
export const MAX_ENGINE_V2_RECIPE_INPUTS = 4
export const MAX_ENGINE_V2_JOB_OUTPUTS = 16
export const MAX_ENGINE_V2_OUTPUT_PATH_BYTES = 512

export const ENGINE_V2_JOB_STATUSES = ['queued', 'running', 'done', 'error', 'cancelled'] as const
export type EngineJobStatusV2 = (typeof ENGINE_V2_JOB_STATUSES)[number]

export interface EngineTimeRangeV2 {
  startSec: number
  endSec: number
}

export interface EngineRecipeInputV2 {
  role: EngineInputRoleV2
  // Library/artifact identity only. Main resolves it to an authorized path;
  // a path here is a contract violation, not a convenience.
  artifactId: string
  range?: EngineTimeRangeV2
}

export interface EngineRecipeV2 {
  protocolVersion: typeof ENGINE_V2_PROTOCOL_VERSION
  operation: EngineOperationIdV2
  providerId: string
  pluginVersion: string
  // sha256 hex of the exact validated descriptor this recipe was built from.
  descriptorHash: string
  profileId: string
  prompt?: string
  lyrics?: string
  inputs: EngineRecipeInputV2[]
  targetDurationSec?: number
  regions?: EngineTimeRangeV2[]
  common?: { negativePrompt?: string; bpm?: number; keyscale?: string; timeSignature?: string }
  advanced?: Record<string, boolean | number | string>
  adapters?: { libraryId: string; scale: number }[]
  seed?: number
}

export interface EngineJobErrorV2 {
  code: string
  message: string
}

export interface EngineJobOutputV2 {
  role: EngineOutputRoleV2
  // Relative path inside the job's staging directory. Must survive
  // engineOutputPathErrorsV2 and the host's containment re-resolution.
  path: string
}

export interface EngineJobStateV2 {
  protocolVersion: typeof ENGINE_V2_PROTOCOL_VERSION
  jobId: string
  status: EngineJobStatusV2
  progress: number
  phase?: string
  error?: EngineJobErrorV2
  outputs?: EngineJobOutputV2[]
}

// Environment-neutral UTF-8 byte measure: the SDK compiles without Node types.
function utf8Bytes(value: string): number {
  let bytes = 0
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
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

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Bytes(value) <= maxBytes
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function uint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff
}

function closed<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function validRange(value: unknown, path: string, errors: string[]): void {
  if (!object(value)) {
    errors.push(`${path}: expected an object`)
    return
  }
  exactKeys(value, ['startSec', 'endSec'], path, errors)
  const start = value.startSec
  const end = value.endSec
  if (
    // Negative starts are meaningful: extending before a source outpaints in
    // front of it. The window still has to be finite, ordered, and bounded.
    !finiteIn(start, -MAX_ENGINE_V2_DURATION_SEC, MAX_ENGINE_V2_DURATION_SEC) ||
    !finiteIn(end, -MAX_ENGINE_V2_DURATION_SEC, MAX_ENGINE_V2_DURATION_SEC) ||
    start >= end
  ) {
    errors.push(`${path}: expected finite startSec < endSec within +-${MAX_ENGINE_V2_DURATION_SEC}`)
  }
}

// Structural validation of an untrusted recipe. Descriptor conformance
// (unknown controls, ranges, adapters) is engineRecipeErrorsV2 below.
export function parseEngineRecipeV2(input: unknown, path = 'recipe'): ParseResult<EngineRecipeV2> {
  const errors: string[] = []
  if (!object(input)) return { ok: false, errors: [`${path}: expected an object`] }
  exactKeys(
    input,
    [
      'protocolVersion',
      'operation',
      'providerId',
      'pluginVersion',
      'descriptorHash',
      'profileId',
      'prompt',
      'lyrics',
      'inputs',
      'targetDurationSec',
      'regions',
      'common',
      'advanced',
      'adapters',
      'seed'
    ],
    path,
    errors
  )
  if (input.protocolVersion !== ENGINE_V2_PROTOCOL_VERSION) {
    errors.push(`${path}.protocolVersion: expected ${ENGINE_V2_PROTOCOL_VERSION}`)
  }
  if (!closed(input.operation, ENGINE_V2_OPERATION_IDS)) {
    errors.push(`${path}.operation: unknown operation id`)
  }
  if (!boundedString(input.providerId, 128)) {
    errors.push(`${path}.providerId: expected a bounded string`)
  }
  if (!boundedString(input.pluginVersion, 64)) {
    errors.push(`${path}.pluginVersion: expected a bounded string`)
  }
  if (typeof input.descriptorHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.descriptorHash)) {
    errors.push(`${path}.descriptorHash: expected a sha256 hex digest`)
  }
  if (!boundedString(input.profileId, 64)) {
    errors.push(`${path}.profileId: expected a bounded string`)
  }
  if (input.prompt !== undefined && !boundedString(input.prompt, MAX_ENGINE_V2_PROMPT_BYTES)) {
    errors.push(`${path}.prompt: expected a bounded string`)
  }
  if (input.lyrics !== undefined && !boundedString(input.lyrics, MAX_ENGINE_V2_LYRICS_BYTES)) {
    errors.push(`${path}.lyrics: expected a bounded string`)
  }

  const inputsValue = input.inputs
  if (!Array.isArray(inputsValue) || inputsValue.length > MAX_ENGINE_V2_RECIPE_INPUTS) {
    errors.push(`${path}.inputs: expected at most ${MAX_ENGINE_V2_RECIPE_INPUTS} inputs`)
  } else {
    inputsValue.forEach((entry, index) => {
      const entryPath = `${path}.inputs[${index}]`
      if (!object(entry)) {
        errors.push(`${entryPath}: expected an object`)
        return
      }
      exactKeys(entry, ['role', 'artifactId', 'range'], entryPath, errors)
      if (!closed(entry.role, ENGINE_V2_INPUT_ROLES)) {
        errors.push(`${entryPath}.role: unknown input role`)
      }
      if (!boundedString(entry.artifactId, 128)) {
        errors.push(`${entryPath}.artifactId: expected a bounded identity`)
      }
      if (entry.range !== undefined) validRange(entry.range, `${entryPath}.range`, errors)
    })
  }

  if (
    input.targetDurationSec !== undefined &&
    !finiteIn(input.targetDurationSec, 1, MAX_ENGINE_V2_DURATION_SEC)
  ) {
    errors.push(`${path}.targetDurationSec: expected 1 through ${MAX_ENGINE_V2_DURATION_SEC}`)
  }

  const regions = input.regions
  if (regions !== undefined) {
    if (!Array.isArray(regions) || regions.length === 0 || regions.length > MAX_ENGINE_V2_RANGES) {
      errors.push(`${path}.regions: expected 1 through ${MAX_ENGINE_V2_RANGES} regions`)
    } else {
      regions.forEach((region, index) => {
        validRange(region, `${path}.regions[${index}]`, errors)
      })
    }
  }

  const common = input.common
  if (common !== undefined) {
    if (!object(common)) {
      errors.push(`${path}.common: expected an object`)
    } else {
      exactKeys(
        common,
        ['negativePrompt', 'bpm', 'keyscale', 'timeSignature'],
        `${path}.common`,
        errors
      )
      if (
        common.negativePrompt !== undefined &&
        !boundedString(common.negativePrompt, MAX_ENGINE_V2_PROMPT_BYTES)
      ) {
        errors.push(`${path}.common.negativePrompt: expected a bounded string`)
      }
      if (common.bpm !== undefined && !finiteIn(common.bpm, 1, 1000)) {
        errors.push(`${path}.common.bpm: expected 1 through 1000`)
      }
      if (common.keyscale !== undefined && !boundedString(common.keyscale, 128)) {
        errors.push(`${path}.common.keyscale: expected a bounded string`)
      }
      if (common.timeSignature !== undefined && !boundedString(common.timeSignature, 64)) {
        errors.push(`${path}.common.timeSignature: expected a bounded string`)
      }
    }
  }

  const advanced = input.advanced
  if (advanced !== undefined) {
    if (!object(advanced)) {
      errors.push(`${path}.advanced: expected an object`)
    } else {
      for (const [key, value] of Object.entries(advanced)) {
        if (!boundedString(key, 64)) {
          errors.push(`${path}.advanced: control ids must be bounded strings`)
        } else if (
          typeof value !== 'boolean' &&
          !(typeof value === 'number' && Number.isFinite(value)) &&
          !boundedString(value, 128)
        ) {
          errors.push(
            `${path}.advanced.${key}: expected a boolean, finite number, or bounded string`
          )
        }
      }
    }
  }

  const adapters = input.adapters
  if (adapters !== undefined) {
    if (!Array.isArray(adapters) || adapters.length > MAX_ENGINE_V2_ACTIVE_ADAPTERS) {
      errors.push(`${path}.adapters: expected at most ${MAX_ENGINE_V2_ACTIVE_ADAPTERS} adapters`)
    } else {
      adapters.forEach((adapter, index) => {
        const adapterPath = `${path}.adapters[${index}]`
        if (!object(adapter)) {
          errors.push(`${adapterPath}: expected an object`)
          return
        }
        exactKeys(adapter, ['libraryId', 'scale'], adapterPath, errors)
        if (!boundedString(adapter.libraryId, 128)) {
          errors.push(`${adapterPath}.libraryId: expected a bounded identity`)
        }
        if (!finiteIn(adapter.scale, -100, 100)) {
          errors.push(`${adapterPath}.scale: expected -100 through 100`)
        }
      })
    }
  }

  if (input.seed !== undefined && !uint32(input.seed)) {
    errors.push(`${path}.seed: expected a uint32`)
  }

  try {
    if (utf8Bytes(JSON.stringify(input)) > MAX_ENGINE_V2_RECIPE_BYTES) {
      errors.push(`${path}: recipe exceeds ${MAX_ENGINE_V2_RECIPE_BYTES} bytes`)
    }
  } catch {
    errors.push(`${path}: recipe is not serializable`)
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as EngineRecipeV2 }
}

function controlValueError(control: EngineAdvancedControlV2, value: unknown): string | null {
  if (control.kind === 'boolean') {
    return typeof value === 'boolean' ? null : 'expected a boolean'
  }
  if (control.kind === 'enum') {
    return typeof value === 'string' && control.values.includes(value)
      ? null
      : 'expected one of the declared values'
  }
  if (!finiteIn(value, control.min, control.max)) {
    return `expected ${control.min} through ${control.max}`
  }
  if (control.kind === 'integer' && !Number.isInteger(value)) return 'expected an integer'
  return null
}

// Semantic conformance of a structurally valid recipe against a validated
// descriptor. Returns every violation so a queue admission failure names the
// real problem instead of the first one.
export function engineRecipeErrorsV2(
  recipe: EngineRecipeV2,
  descriptor: EngineDescriptorV2,
  path = 'recipe'
): string[] {
  const errors: string[] = []
  const operation = descriptor.operations.find((candidate) => candidate.id === recipe.operation)
  if (!operation) return [`${path}.operation: engine does not declare ${recipe.operation}`]

  if (!operation.profileIds.includes(recipe.profileId)) {
    errors.push(`${path}.profileId: not declared for ${operation.id}`)
  }

  if (operation.prompt === null) {
    if (recipe.prompt !== undefined) errors.push(`${path}.prompt: operation takes no prompt`)
  } else {
    if (operation.prompt.required && recipe.prompt === undefined) {
      errors.push(`${path}.prompt: operation requires a prompt`)
    }
    if (recipe.prompt !== undefined && utf8Bytes(recipe.prompt) > operation.prompt.maxBytes) {
      errors.push(`${path}.prompt: exceeds the declared limit`)
    }
  }

  if (operation.lyrics === null) {
    if (recipe.lyrics !== undefined) errors.push(`${path}.lyrics: operation takes no lyrics`)
  } else if (recipe.lyrics !== undefined && utf8Bytes(recipe.lyrics) > operation.lyrics.maxBytes) {
    errors.push(`${path}.lyrics: exceeds the declared limit`)
  }

  if (operation.duration === null) {
    if (recipe.targetDurationSec !== undefined) {
      errors.push(`${path}.targetDurationSec: operation takes no target duration`)
    }
  } else if (
    recipe.targetDurationSec !== undefined &&
    (recipe.targetDurationSec < operation.duration.minSec ||
      recipe.targetDurationSec > operation.duration.maxSec)
  ) {
    errors.push(`${path}.targetDurationSec: outside the declared range`)
  }

  const declaredInputs = new Map(operation.inputs.map((input) => [input.role, input]))
  const seenRoles = new Set<string>()
  recipe.inputs.forEach((input, index) => {
    const inputPath = `${path}.inputs[${index}]`
    const declared = declaredInputs.get(input.role)
    if (!declared) {
      errors.push(`${inputPath}.role: operation does not accept ${input.role}`)
      return
    }
    if (seenRoles.has(input.role)) errors.push(`${inputPath}.role: duplicate role`)
    seenRoles.add(input.role)
    if (input.range && declared.maxRanges === 0) {
      errors.push(`${inputPath}.range: operation does not accept ranges`)
    }
  })
  for (const declared of operation.inputs) {
    if (declared.required && !seenRoles.has(declared.role)) {
      errors.push(`${path}.inputs: missing required ${declared.role} input`)
    }
  }

  const regions = recipe.regions ?? []
  const sourceInput = declaredInputs.get('source')
  const maxRegions = sourceInput?.maxRanges ?? 0
  if (regions.length > maxRegions) {
    errors.push(`${path}.regions: operation accepts at most ${maxRegions} regions`)
  }

  const declaredControls = new Map(
    operation.advancedControls.map((control) => [control.id, control])
  )
  for (const [key, value] of Object.entries(recipe.advanced ?? {})) {
    const control = declaredControls.get(key)
    if (!control) {
      errors.push(`${path}.advanced.${key}: engine does not declare this control`)
      continue
    }
    const problem = controlValueError(control, value)
    if (problem) errors.push(`${path}.advanced.${key}: ${problem}`)
  }
  const declaredCommon = new Set<string>(operation.commonControls)
  for (const key of Object.keys(recipe.common ?? {})) {
    if (!declaredCommon.has(key)) {
      errors.push(`${path}.common.${key}: engine does not honor this control`)
    }
  }

  const adapters = recipe.adapters ?? []
  if (operation.adapters === null) {
    if (adapters.length > 0) errors.push(`${path}.adapters: operation takes no adapters`)
  } else if (adapters.length > operation.adapters.maxActive) {
    errors.push(`${path}.adapters: operation accepts at most ${operation.adapters.maxActive}`)
  }

  if (operation.seed === 'none' && recipe.seed !== undefined) {
    errors.push(`${path}.seed: operation defines no seed semantics`)
  }
  return errors
}

// Relative staging paths only: no absolute paths, drive letters, parent or
// empty segments, backslashes, or control characters. The host still resolves
// and re-proves containment before touching any file.
export function engineOutputPathErrorsV2(path: string): string[] {
  const errors: string[] = []
  if (typeof path !== 'string' || path.length === 0) return ['output path is empty']
  if (utf8Bytes(path) > MAX_ENGINE_V2_OUTPUT_PATH_BYTES) {
    errors.push('output path is too long')
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) errors.push('output path has control characters')
  if (path.includes('\\')) errors.push('output path uses backslashes')
  if (path.includes(':')) errors.push('output path has a drive or stream separator')
  if (path.startsWith('/')) errors.push('output path is absolute')
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    errors.push('output path has empty, dot, or parent segments')
  }
  if (segments.some(trimmedByWindows)) {
    errors.push('output path has a name ending in a dot or space')
  }
  return errors
}

export function parseEngineJobOutputsV2(
  input: unknown,
  operation: EngineOperationV2,
  path = 'outputs'
): ParseResult<EngineJobOutputV2[]> {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ENGINE_V2_JOB_OUTPUTS) {
    return {
      ok: false,
      errors: [`${path}: expected 1 through ${MAX_ENGINE_V2_JOB_OUTPUTS} outputs`]
    }
  }
  const errors: string[] = []
  const counts = new Map<string, number>()
  const claims = new Map(operation.outputs.map((output) => [output.role, output.maxCount]))
  const paths = new Set<string>()
  input.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`
    if (!object(entry)) {
      errors.push(`${entryPath}: expected an object`)
      return
    }
    exactKeys(entry, ['role', 'path'], entryPath, errors)
    const role = entry.role
    if (!closed(role, ENGINE_V2_OUTPUT_ROLES)) {
      errors.push(`${entryPath}.role: unknown output role`)
      return
    }
    const claim = claims.get(role)
    if (claim === undefined) {
      errors.push(`${entryPath}.role: operation does not declare ${role} outputs`)
      return
    }
    const count = (counts.get(role) ?? 0) + 1
    counts.set(role, count)
    if (count > claim) errors.push(`${entryPath}.role: more ${role} outputs than declared`)
    const outputPath = typeof entry.path === 'string' ? entry.path : ''
    for (const problem of engineOutputPathErrorsV2(outputPath)) {
      errors.push(`${entryPath}.path: ${problem}`)
    }
    const key = scalarKey(entry.path)
    if (paths.has(key)) errors.push(`${entryPath}.path: duplicate output path`)
    paths.add(key)
  })
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as EngineJobOutputV2[] }
}

export function parseEngineJobStateV2(
  input: unknown,
  descriptor?: EngineDescriptorV2,
  path = 'job'
): ParseResult<EngineJobStateV2> {
  const errors: string[] = []
  if (!object(input)) return { ok: false, errors: [`${path}: expected an object`] }
  exactKeys(
    input,
    ['protocolVersion', 'jobId', 'status', 'progress', 'phase', 'error', 'outputs'],
    path,
    errors
  )
  if (input.protocolVersion !== ENGINE_V2_PROTOCOL_VERSION) {
    errors.push(`${path}.protocolVersion: expected ${ENGINE_V2_PROTOCOL_VERSION}`)
  }
  if (!boundedString(input.jobId, 128)) errors.push(`${path}.jobId: expected a bounded id`)
  const status = input.status
  if (!closed(status, ENGINE_V2_JOB_STATUSES)) {
    errors.push(`${path}.status: unknown status`)
    return { ok: false, errors }
  }
  const progress = input.progress
  if (!finiteIn(progress, 0, 1)) {
    errors.push(`${path}.progress: expected a finite value from 0 through 1`)
  }
  if (status === 'done' && progress !== 1) errors.push(`${path}.progress: done requires 1`)

  const phase = input.phase
  if (phase !== undefined) {
    if (!boundedString(phase, 64)) {
      errors.push(`${path}.phase: expected a bounded id`)
    } else if (descriptor && !descriptor.phases.includes(phase)) {
      errors.push(`${path}.phase: engine did not declare this phase`)
    }
  }

  const error = input.error
  if (status === 'error') {
    if (!object(error)) {
      errors.push(`${path}.error: expected an object for a failed job`)
    } else {
      exactKeys(error, ['code', 'message'], `${path}.error`, errors)
      if (!boundedString(error.code, 64)) errors.push(`${path}.error.code: expected a bounded code`)
      if (!boundedString(error.message, 1024)) {
        errors.push(`${path}.error.message: expected a bounded message`)
      }
    }
  } else if (error !== undefined) {
    errors.push(`${path}.error: only failed jobs carry an error`)
  }

  const outputs = input.outputs
  if (status !== 'done' && outputs !== undefined) {
    errors.push(`${path}.outputs: only completed jobs carry outputs`)
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as EngineJobStateV2 }
}

function broadened(pathText: string, errors: string[]): void {
  errors.push(`${pathText}: live descriptor broadens the signed claim`)
}

// Live facts may remove or narrow signed claims; they may never add or
// broaden them. The host rejects an inconsistent live descriptor instead of
// guessing a usable profile.
export function engineDescriptorNarrowingErrorsV2(
  signed: EngineDescriptorV2,
  live: EngineDescriptorV2,
  path = 'live'
): string[] {
  const errors: string[] = []
  if (live.engineFamily !== signed.engineFamily) {
    errors.push(`${path}.engineFamily: does not match the signed descriptor`)
  }
  const signedModels = new Set(signed.models.map((model) => `${model.id}@${model.revision}`))
  for (const model of live.models) {
    if (!signedModels.has(`${model.id}@${model.revision}`)) {
      broadened(`${path}.models.${model.id}@${model.revision}`, errors)
    }
  }
  const signedProfiles = new Set(signed.profiles.map((profile) => profile.id))
  for (const profile of live.profiles) {
    if (!signedProfiles.has(profile.id)) broadened(`${path}.profiles.${profile.id}`, errors)
  }
  const signedPhases = new Set(signed.phases)
  for (const phase of live.phases) {
    if (!signedPhases.has(phase)) broadened(`${path}.phases.${phase}`, errors)
  }

  const signedOperations = new Map(signed.operations.map((operation) => [operation.id, operation]))
  for (const operation of live.operations) {
    const opPath = `${path}.operations.${operation.id}`
    const signedOp = signedOperations.get(operation.id)
    if (!signedOp) {
      broadened(opPath, errors)
      continue
    }
    const signedInputs = new Map(signedOp.inputs.map((input) => [input.role, input]))
    for (const input of operation.inputs) {
      const signedInput = signedInputs.get(input.role)
      if (!signedInput) {
        broadened(`${opPath}.inputs.${input.role}`, errors)
        continue
      }
      if (input.formats.some((format) => !signedInput.formats.includes(format))) {
        broadened(`${opPath}.inputs.${input.role}.formats`, errors)
      }
      if (input.maxDurationSec > signedInput.maxDurationSec) {
        broadened(`${opPath}.inputs.${input.role}.maxDurationSec`, errors)
      }
      if (input.maxRanges > signedInput.maxRanges) {
        broadened(`${opPath}.inputs.${input.role}.maxRanges`, errors)
      }
    }
    if (operation.prompt && !signedOp.prompt) broadened(`${opPath}.prompt`, errors)
    if (
      operation.prompt &&
      signedOp.prompt &&
      operation.prompt.maxBytes > signedOp.prompt.maxBytes
    ) {
      broadened(`${opPath}.prompt.maxBytes`, errors)
    }
    if (operation.lyrics && !signedOp.lyrics) broadened(`${opPath}.lyrics`, errors)
    if (
      operation.lyrics &&
      signedOp.lyrics &&
      operation.lyrics.maxBytes > signedOp.lyrics.maxBytes
    ) {
      broadened(`${opPath}.lyrics.maxBytes`, errors)
    }
    if (operation.duration && !signedOp.duration) broadened(`${opPath}.duration`, errors)
    if (operation.duration && signedOp.duration) {
      if (
        operation.duration.minSec < signedOp.duration.minSec ||
        operation.duration.maxSec > signedOp.duration.maxSec
      ) {
        broadened(`${opPath}.duration`, errors)
      }
    }
    const signedOutputs = new Map(signedOp.outputs.map((output) => [output.role, output.maxCount]))
    for (const output of operation.outputs) {
      const claim = signedOutputs.get(output.role)
      if (claim === undefined || output.maxCount > claim) {
        broadened(`${opPath}.outputs.${output.role}`, errors)
      }
    }
    for (const control of operation.commonControls) {
      if (!signedOp.commonControls.includes(control)) {
        broadened(`${opPath}.commonControls.${control}`, errors)
      }
    }
    const signedControls = new Map(
      signedOp.advancedControls.map((control) => [control.id, control])
    )
    for (const control of operation.advancedControls) {
      const signedControl = signedControls.get(control.id)
      if (signedControl?.kind !== control.kind) {
        broadened(`${opPath}.advancedControls.${control.id}`, errors)
        continue
      }
      if (control.kind === 'enum' && signedControl.kind === 'enum') {
        if (control.values.some((entry) => !signedControl.values.includes(entry))) {
          broadened(`${opPath}.advancedControls.${control.id}.values`, errors)
        }
      }
      if (
        (control.kind === 'number' || control.kind === 'integer') &&
        (signedControl.kind === 'number' || signedControl.kind === 'integer') &&
        (control.min < signedControl.min || control.max > signedControl.max)
      ) {
        broadened(`${opPath}.advancedControls.${control.id}.range`, errors)
      }
    }
    for (const profileId of operation.profileIds) {
      if (!signedOp.profileIds.includes(profileId)) {
        broadened(`${opPath}.profileIds.${profileId}`, errors)
      }
    }
    if (operation.adapters) {
      if (!signedOp.adapters) {
        broadened(`${opPath}.adapters`, errors)
      } else {
        if (operation.adapters.maxActive > signedOp.adapters.maxActive) {
          broadened(`${opPath}.adapters.maxActive`, errors)
        }
        for (const family of operation.adapters.families) {
          if (!signedOp.adapters.families.includes(family)) {
            broadened(`${opPath}.adapters.families.${family}`, errors)
          }
        }
      }
    }
    if (operation.seed !== 'none' && operation.seed !== signedOp.seed) {
      broadened(`${opPath}.seed`, errors)
    }
    if (operation.cancellation && !signedOp.cancellation) {
      broadened(`${opPath}.cancellation`, errors)
    }
  }
  return errors
}
