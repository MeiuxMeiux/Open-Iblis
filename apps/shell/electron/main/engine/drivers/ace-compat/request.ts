// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { randomBytes } from 'node:crypto'
import type { GenerateConfig, GenerateRequest } from '@iblis/plugin-sdk'
import { ENGINE_TIME_SIGNATURES, profilesFromProps, type EngineProps } from './props'

const MAX_REQUEST_BYTES = 48 * 1024
const MAX_REQUEST_TEXT = 16 * 1024
const MAX_REQUEST_LYRICS = 32 * 1024
const UINT32_MAX = 0xffff_ffff
const CONFIG_KEYS = new Set<keyof GenerateConfig>([
  'negativePrompt',
  'bpm',
  'keyscale',
  'steps',
  'guidance',
  'solver',
  'temperature',
  'rewritePrompt',
  'autoLyrics',
  'lmModel',
  'synthModel',
  'timeSignature',
  'shift',
  'adapter',
  'adapterScale',
  'lmSeed'
])

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function uint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= UINT32_MAX
}

function boundedString(value: unknown, max = MAX_REQUEST_TEXT): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max
}

function optionalNumber(
  value: unknown,
  { min, max, integer = false }: { min: number; max: number; integer?: boolean }
): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (!integer || Number.isInteger(value)))
  )
}

// Used both at IPC admission and while rehydrating the persisted queue. It is
// intentionally structural and closed over known config keys so corrupt or
// future-shaped requests cannot reach native code by bypassing the renderer.
export function generationRequestError(value: unknown): string | null {
  if (!plainObject(value)) return 'generation request is invalid'
  const request = value as Partial<GenerateRequest> & Record<string, unknown>
  if (
    !boundedString(request.prompt) ||
    !request.prompt.trim() ||
    !boundedString(request.preset, 128) ||
    !request.preset ||
    typeof request.durationSec !== 'number' ||
    !Number.isFinite(request.durationSec) ||
    request.durationSec < 4 ||
    request.durationSec > 240 ||
    (request.seed !== undefined && !uint32(request.seed)) ||
    (request.lyrics !== undefined && !boundedString(request.lyrics, MAX_REQUEST_LYRICS))
  ) {
    return 'generation request is invalid or too large'
  }

  const rawConfig = request.config
  if (rawConfig !== undefined && !plainObject(rawConfig)) {
    return 'generation request config is invalid'
  }
  const config = rawConfig ?? {}
  if (Object.keys(config).some((key) => !CONFIG_KEYS.has(key as keyof GenerateConfig))) {
    return 'generation request config has unknown fields'
  }
  if (
    !boundedString(config.negativePrompt ?? '') ||
    !boundedString(config.keyscale ?? '', 128) ||
    !boundedString(config.timeSignature ?? '', 64) ||
    !boundedString(config.lmModel ?? '', 512) ||
    !boundedString(config.synthModel ?? '', 512) ||
    !boundedString(config.adapter ?? '', 512) ||
    !optionalNumber(config.bpm, { min: 1, max: 1000, integer: true }) ||
    !optionalNumber(config.steps, { min: 1, max: 1000, integer: true }) ||
    !optionalNumber(config.guidance, { min: 0, max: 100 }) ||
    !optionalNumber(config.temperature, { min: 0, max: 10 }) ||
    !optionalNumber(config.shift, { min: 0, max: 20 }) ||
    !optionalNumber(config.adapterScale, { min: -100, max: 100 }) ||
    (config.lmSeed !== undefined && !uint32(config.lmSeed)) ||
    (config.solver !== undefined &&
      (typeof config.solver !== 'string' ||
        !['euler', 'sde', 'dpm3m', 'stork4'].includes(config.solver))) ||
    (config.rewritePrompt !== undefined && typeof config.rewritePrompt !== 'boolean') ||
    (config.autoLyrics !== undefined && typeof config.autoLyrics !== 'boolean')
  ) {
    return 'generation request config is invalid or too large'
  }

  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_REQUEST_BYTES) {
      return 'generation request is too large'
    }
  } catch {
    return 'generation request is invalid'
  }
  return null
}

export function canonicalRequestError(value: unknown): string | null {
  const basic = generationRequestError(value)
  if (basic) return basic
  const request = value as GenerateRequest
  const config = request.config
  if (!uint32(request.seed) || !config || !uint32(config.lmSeed)) {
    return 'generation request seeds were not resolved'
  }
  if (
    !['turbo-validated', 'turbo-expert', 'xl-turbo-experiment', 'sft-experiment'].includes(
      request.preset
    ) ||
    !config.lmModel ||
    !config.synthModel ||
    config.guidance === undefined ||
    config.shift === undefined ||
    config.shift <= 0 ||
    config.solver === undefined ||
    config.temperature === undefined ||
    config.rewritePrompt === undefined ||
    config.autoLyrics === undefined ||
    config.adapterScale === undefined ||
    (config.timeSignature !== undefined &&
      !(ENGINE_TIME_SIGNATURES as readonly string[]).includes(config.timeSignature)) ||
    config.steps === undefined ||
    !Number.isInteger(config.steps) ||
    (request.preset === 'turbo-validated' &&
      (config.steps !== 8 ||
        config.guidance !== 1 ||
        config.shift !== 3 ||
        config.solver !== 'euler')) ||
    (request.preset === 'turbo-expert' &&
      (config.steps < 1 || config.steps > 20 || config.guidance !== 1)) ||
    (request.preset === 'xl-turbo-experiment' && (config.steps !== 8 || config.guidance !== 1)) ||
    (request.preset === 'sft-experiment' &&
      (config.steps !== 50 || config.guidance < 1 || config.guidance > 7))
  ) {
    return 'generation request was not canonically resolved'
  }
  return null
}

function systemUint32(): number {
  return randomBytes(4).readUInt32LE(0)
}

function clean(value: string | undefined): string {
  return value?.trim() ?? ''
}

function chooseInstalled(
  value: string | undefined,
  fallback: string,
  installed: string[],
  label: string
) {
  const selected = clean(value) || fallback
  if (!installed.includes(selected)) throw new Error(`${label} is not installed`)
  return selected
}

type EngineProfile = ReturnType<typeof profilesFromProps>[number]

// Steps and guidance within the profile's range; validated profiles also lock
// shift and solver. Error order is part of the contract the tests pin.
function checkProfileLimits(
  profile: EngineProfile,
  input: GenerateConfig,
  requestedShift: number | undefined
) {
  const steps = input.steps ?? profile.steps.default
  if (!Number.isInteger(steps) || steps < profile.steps.min || steps > profile.steps.max) {
    throw new Error(`${profile.name} steps must be ${profile.steps.min}–${profile.steps.max}`)
  }
  const guidance = input.guidance ?? profile.guidance.default
  if (guidance < profile.guidance.min || guidance > profile.guidance.max) {
    throw new Error(
      `${profile.name} guidance must be ${profile.guidance.min}–${profile.guidance.max}`
    )
  }
  if (profile.kind === 'validated') {
    if (requestedShift !== undefined && requestedShift !== profile.shift) {
      throw new Error(`${profile.name} shift is locked to ${profile.shift}`)
    }
    if (input.solver !== undefined && input.solver !== profile.solver) {
      throw new Error(`${profile.name} solver is locked to ${profile.solver}`)
    }
  }
  return { steps, guidance }
}

function chooseModels(input: GenerateConfig, profile: EngineProfile, props: EngineProps) {
  const lmModel = chooseInstalled(input.lmModel, props.defaultLmModel, props.lmModels, 'LM model')
  const synthModel = chooseInstalled(
    input.synthModel,
    profile.synthModel,
    props.synthModels,
    'synthesis model'
  )
  if (synthModel !== profile.synthModel) {
    throw new Error(`${profile.name} requires synthesis model ${profile.synthModel}`)
  }
  const adapter = chooseInstalled(
    input.adapter,
    props.defaultAdapter,
    props.defaultAdapter ? props.adapters : ['', ...props.adapters],
    'adapter'
  )
  return { lmModel, synthModel, adapter }
}

function chooseTimeSignature(value: string | undefined, props: EngineProps) {
  const timeSignature = clean(value) || props.defaultTimeSignature
  if (!(ENGINE_TIME_SIGNATURES as readonly string[]).includes(timeSignature)) {
    throw new Error('beats per bar must be Auto, 2, 3, 4, or 6')
  }
  return timeSignature
}

// Resolve a renderer draft into the immutable request persisted by the queue.
// Random synthesis and LM seeds are sampled independently here and nowhere
// else; retries, duplicates, ratings, and provenance therefore name one recipe.
export function resolveGenerationRequest(
  request: GenerateRequest,
  props: EngineProps,
  randomUint32: () => number = systemUint32
): GenerateRequest {
  const invalid = generationRequestError(request)
  if (invalid) throw new Error(invalid)
  const profile = profilesFromProps(props).find((candidate) => candidate.id === request.preset)
  if (!profile) throw new Error(`engine profile ${request.preset} is unavailable`)
  const input = request.config ?? {}
  const requestedShift = input.shift === 0 ? undefined : input.shift
  const { steps, guidance } = checkProfileLimits(profile, input, requestedShift)
  const { lmModel, synthModel, adapter } = chooseModels(input, profile, props)
  const seed = request.seed ?? randomUint32()
  const lmSeed = input.lmSeed ?? randomUint32()
  if (!uint32(seed) || !uint32(lmSeed)) throw new Error('seed source did not return a uint32')

  const negativePrompt = clean(input.negativePrompt)
  const keyscale = clean(input.keyscale)
  const timeSignature = chooseTimeSignature(input.timeSignature, props)
  const config: GenerateConfig = {
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(input.bpm === undefined ? {} : { bpm: input.bpm }),
    ...(keyscale ? { keyscale } : {}),
    steps,
    guidance,
    solver: input.solver ?? profile.solver,
    temperature: input.temperature ?? props.defaultTemperature,
    rewritePrompt: input.rewritePrompt ?? props.defaultRewritePrompt,
    autoLyrics: input.autoLyrics ?? false,
    lmModel,
    synthModel,
    ...(timeSignature ? { timeSignature } : {}),
    shift: requestedShift ?? profile.shift,
    ...(adapter ? { adapter } : {}),
    adapterScale: input.adapterScale ?? props.defaultAdapterScale,
    lmSeed
  }
  const resolved: GenerateRequest = {
    prompt: request.prompt.trim(),
    ...(request.lyrics?.trim() ? { lyrics: request.lyrics } : {}),
    durationSec: request.durationSec,
    seed,
    preset: profile.id,
    config
  }
  const canonicalError = canonicalRequestError(resolved)
  if (canonicalError) throw new Error(canonicalError)
  return resolved
}
