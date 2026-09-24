// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EngineSolver } from '@iblis/plugin-sdk'
import type { EngineProfile, EngineRuntimeInfo } from '../../../../../shared/contract'
import { ignoreFailure } from '../../../ignore-failure'

export const MAX_ENGINE_PROPS_BYTES = 256 * 1024
const MAX_NAME_BYTES = 512
const MAX_VERSION_BYTES = 128
const MAX_OPTIONS = 64
const ENGINE_SOLVERS: readonly EngineSolver[] = ['euler', 'sde', 'dpm3m', 'stork4']
export const ENGINE_TIME_SIGNATURES = ['', '2', '3', '4', '6'] as const

interface SamplingPreset {
  inferenceSteps: number
  guidanceScale: number
  shift: number
}

export interface EngineProps {
  version: string
  lmModels: string[]
  synthModels: string[]
  adapters: string[]
  defaultLmModel: string
  defaultSynthModel: string
  defaultTemperature: number
  defaultSolver: EngineSolver
  defaultTimeSignature: string
  defaultRewritePrompt: boolean
  defaultAdapter: string
  defaultAdapterScale: number
  turbo?: SamplingPreset
  sft?: SamplingPreset
}

class EnginePropsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnginePropsError'
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EnginePropsError(`${label} is not an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string, maxBytes = MAX_NAME_BYTES): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new EnginePropsError(`${label} is invalid`)
  }
  return value
}

function optionalString(value: unknown, label: string): string {
  if (value === undefined || value === '') return ''
  return string(value, label)
}

function stringArray(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > MAX_OPTIONS || (!allowEmpty && value.length === 0)) {
    throw new EnginePropsError(`${label} is invalid`)
  }
  const result = value.map((entry, index) => string(entry, `${label}[${index}]`))
  if (new Set(result).size !== result.length) throw new EnginePropsError(`${label} has duplicates`)
  return result
}

// stringArray() without allowEmpty already guarantees an entry; this narrows it.
function firstOf(list: string[], label: string): string {
  const head = list[0]
  if (head === undefined) throw new EnginePropsError(`${label} is invalid`)
  return head
}

function finite(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new EnginePropsError(`${label} is invalid`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new EnginePropsError(`${label} is invalid`)
  return value
}

function preset(value: unknown, label: string): SamplingPreset {
  const raw = object(value, label)
  const inferenceSteps = finite(raw.inference_steps, `${label}.inference_steps`, 1, 1000)
  if (!Number.isInteger(inferenceSteps)) {
    throw new EnginePropsError(`${label}.inference_steps is invalid`)
  }
  return {
    inferenceSteps,
    guidanceScale: finite(raw.guidance_scale, `${label}.guidance_scale`, 0, 100),
    shift: finite(raw.shift, `${label}.shift`, 0, 100)
  }
}

function solver(value: unknown): EngineSolver {
  if (typeof value !== 'string' || !(ENGINE_SOLVERS as readonly string[]).includes(value)) {
    throw new EnginePropsError('default.solver is invalid')
  }
  return value as EngineSolver
}

function timeSignature(value: unknown): string {
  if (typeof value !== 'string' || !(ENGINE_TIME_SIGNATURES as readonly string[]).includes(value)) {
    throw new EnginePropsError('default.timesignature is invalid')
  }
  return value
}

// Parse only the small, security-relevant projection Iblis uses. Model names
// remain exact registry identifiers; malformed, duplicate, or oversized
// options fail the entire response instead of leaking partial controls upward.
export function parseEngineProps(value: unknown): EngineProps {
  const root = object(value, 'engine props')
  const models = object(root.models, 'models')
  const lmModels = stringArray(models.lm, 'models.lm')
  const synthModels = stringArray(models.dit, 'models.dit')
  // Generation needs both singleton buckets even though the UI never selects
  // them. Missing buckets mean this /props cannot describe a usable engine.
  stringArray(models.embedding, 'models.embedding')
  stringArray(models.vae, 'models.vae')

  const adapters = stringArray(root.adapters, 'adapters', true)
  const defaults = object(root.default, 'default')
  const defaultLmModel =
    optionalString(defaults.lm_model, 'default.lm_model') || firstOf(lmModels, 'models.lm')
  const defaultSynthModel =
    optionalString(defaults.synth_model, 'default.synth_model') ||
    firstOf(synthModels, 'models.dit')
  const defaultAdapter = optionalString(defaults.adapter, 'default.adapter')
  if (!lmModels.includes(defaultLmModel)) {
    throw new EnginePropsError('default.lm_model is not installed')
  }
  if (!synthModels.includes(defaultSynthModel)) {
    throw new EnginePropsError('default.synth_model is not installed')
  }
  if (defaultAdapter && !adapters.includes(defaultAdapter)) {
    throw new EnginePropsError('default.adapter is not installed')
  }

  const presets = object(root.presets, 'presets')
  return {
    version: string(root.version, 'version', MAX_VERSION_BYTES),
    lmModels,
    synthModels,
    adapters,
    defaultLmModel,
    defaultSynthModel,
    defaultTemperature: finite(defaults.lm_temperature, 'default.lm_temperature', 0, 10),
    defaultSolver: solver(defaults.solver),
    defaultTimeSignature: timeSignature(defaults.timesignature),
    defaultRewritePrompt: boolean(defaults.use_cot_caption, 'default.use_cot_caption'),
    defaultAdapter,
    defaultAdapterScale: finite(defaults.adapter_scale, 'default.adapter_scale', -100, 100),
    ...(presets.turbo === undefined ? {} : { turbo: preset(presets.turbo, 'presets.turbo') }),
    ...(presets.sft === undefined ? {} : { sft: preset(presets.sft, 'presets.sft') })
  }
}

async function boundedText(response: Response): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > MAX_ENGINE_PROPS_BYTES) {
      throw new EnginePropsError('engine /props response is too large')
    }
  }
  if (!response.body) throw new EnginePropsError('engine /props response has no body')

  // The sidecar's stream is not trusted to yield only chunks; empty reads skip.
  const reader: ReadableStreamDefaultReader<Uint8Array | undefined> = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_ENGINE_PROPS_BYTES) {
      await reader.cancel().catch(ignoreFailure)
      throw new EnginePropsError('engine /props response is too large')
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new EnginePropsError('engine /props response is not valid UTF-8')
  }
}

export async function readEngineProps(response: Response): Promise<EngineProps> {
  if (!response.ok) throw new EnginePropsError(`engine /props returned HTTP ${response.status}`)
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    throw new EnginePropsError('engine /props did not return JSON')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await boundedText(response))
  } catch (error) {
    if (error instanceof EnginePropsError) throw error
    throw new EnginePropsError('engine /props response is not valid JSON')
  }
  return parseEngineProps(parsed)
}

function isTurboModel(name: string): boolean {
  return /(?:^|[-_.])turbo(?:[-_.]|$)/i.test(name)
}

function isSftModel(name: string): boolean {
  return /(?:^|[-_.])sft(?:[-_.]|$)/i.test(name)
}

// ACE-Step 1.5 XL (4B DiT) GGUFs carry an `xl` token (acestep-v15-xl-turbo-*).
// They share the upstream turbo/sft sampling presets but are a different
// model, so they never stand in for the validated 2B recipe.
function isXlModel(name: string): boolean {
  return /(?:^|[-_.])xl(?:[-_.]|$)/i.test(name)
}

// The only validated alpha.9 recipe is the exact upstream turbo tuple. The
// expert profile deliberately keeps CFG/shift/solver fixed and varies only
// steps in a narrow 1..20 lab range.
export function profilesFromProps(props: EngineProps): EngineProfile[] {
  const turboModel = props.synthModels.find((name) => isTurboModel(name) && !isXlModel(name))
  const xlTurboModel = props.synthModels.find((name) => isTurboModel(name) && isXlModel(name))
  const sftModel = props.synthModels.find((name) => isSftModel(name) && !isXlModel(name))
  const profiles: EngineProfile[] = []
  const turboTuple =
    props.defaultSolver === 'euler' &&
    props.turbo?.inferenceSteps === 8 &&
    props.turbo.guidanceScale === 1 &&
    props.turbo.shift === 3
  const turboBase = {
    guidance: { default: 1, min: 1, max: 1 },
    shift: 3,
    solver: 'euler' as const
  }
  if (turboModel && turboTuple) {
    profiles.push(
      {
        ...turboBase,
        synthModel: turboModel,
        id: 'turbo-validated',
        name: 'Turbo / 8',
        kind: 'validated',
        steps: { default: 8, min: 8, max: 8 }
      },
      {
        ...turboBase,
        synthModel: turboModel,
        id: 'turbo-expert',
        name: 'Turbo experiment',
        kind: 'expert',
        steps: { default: 8, min: 1, max: 20 }
      }
    )
  }
  // Pack 0.1.5 bakeoff candidate: the XL turbo at the same distilled 8-step
  // tuple, fixed so Turbo/8 vs XL Turbo/8 differ only by DiT. An experiment,
  // never a quality tier (docs/feature/generation-quality.md).
  if (xlTurboModel && turboTuple) {
    profiles.push({
      ...turboBase,
      synthModel: xlTurboModel,
      id: 'xl-turbo-experiment',
      name: 'XL Turbo / 8 experiment',
      kind: 'expert',
      steps: { default: 8, min: 8, max: 8 }
    })
  }
  if (
    sftModel &&
    props.defaultSolver === 'euler' &&
    props.sft?.inferenceSteps === 50 &&
    props.sft.guidanceScale === 1 &&
    props.sft.shift === 1
  ) {
    profiles.push({
      id: 'sft-experiment',
      name: 'SFT / 50 experiment',
      kind: 'expert',
      synthModel: sftModel,
      steps: { default: 50, min: 50, max: 50 },
      guidance: { default: 1, min: 1, max: 7 },
      shift: 1,
      solver: 'euler'
    })
  }
  return profiles
}

export function runtimeFromProps(props: EngineProps): EngineRuntimeInfo {
  return {
    version: props.version,
    lmModels: [...props.lmModels],
    synthModels: [...props.synthModels],
    adapters: [...props.adapters],
    solvers: [...ENGINE_SOLVERS],
    defaultLmModel: props.defaultLmModel,
    defaultSynthModel: props.defaultSynthModel,
    defaultTemperature: props.defaultTemperature
  }
}
