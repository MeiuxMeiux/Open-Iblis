// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import type { AudioAnalysis } from '../../../shared/contract'
import type {
  GenerationPhaseTiming,
  GenerationRecordV1,
  GenerationTraceEvent,
  ResolvedGenerationRecipe
} from '../../../shared/generation-record'
import type { TrackRecord } from './store'
import { ignoreFailure } from '../ignore-failure'

export const GENERATION_FILENAME = 'generation.json'
export const MAX_GENERATION_BYTES = 256 * 1024
const MAX_RECIPES = 4
const MAX_TRACE_EVENTS = 48
const MAX_TEXT = 16 * 1024
const MAX_AUDIO_CODES = 128 * 1024
const MAX_RESOLVED_BYTES = 160 * 1024
const mutations = new Map<string, Promise<void>>()

const RECIPE_KEYS = new Set([
  'caption',
  'lyrics',
  'lm_negative_prompt',
  'bpm',
  'duration',
  'keyscale',
  'timesignature',
  'vocal_language',
  'seed',
  'lm_seed',
  'inference_steps',
  'guidance_scale',
  'shift',
  'solver',
  'lm_temperature',
  'use_cot_caption',
  'lm_model',
  'synth_model',
  'adapter',
  'adapter_scale',
  'vae',
  'audio_codes',
  // Engine contract v2 identity facts (exact queue targeting, roadmap 4C).
  'operation',
  'provider_id',
  'plugin_version',
  'descriptor_hash',
  'profile_id',
  'target_duration_sec',
  // Capability-driven Create (roadmap 4D): resolved model, bounded advanced
  // controls as a JSON string, and which extra outputs were kept.
  'engine_family',
  'model_id',
  'model_revision',
  'advanced',
  'preview_output'
])

export interface GenerationEvidenceInput {
  jobId: string
  request: GenerateRequest
  startedAt: number
  finishedAt: number
  phases: GenerationPhaseTiming[]
  trace: GenerationTraceEvent[]
  resolvedSynthText: string
  effectiveRequest: Record<string, unknown>
  engine: { id: string; version: string | null }
}

// A record read back from disk is untrusted: nested objects may be null or
// missing and tags may hold any value, so the validators take this shape.
type AnalysisSummary = NonNullable<GenerationRecordV1['output']['analysis']>
type ParsedAnalysisSummary = Omit<AnalysisSummary, 'audible'> & {
  audible?: AnalysisSummary['audible'] | null
}
type ParsedRequest = Omit<GenerateRequest, 'config'> & { config?: unknown }

interface ParsedRecord {
  schema?: unknown
  jobId?: unknown
  request?: ParsedRequest | null
  startedAt?: unknown
  finishedAt?: unknown
  engine?: { pluginId?: unknown; pluginVersion?: unknown } | null
  phases?: (GenerationPhaseTiming | null)[]
  trace?: (GenerationTraceEvent | null)[]
  resolvedRecipes?: unknown[]
  result?: { status?: unknown; trackId?: unknown; format?: unknown } | null
  output?: {
    codec?: unknown
    sizeBytes?: unknown
    audio?: GenerationRecordV1['output']['audio'] | null
    analysis?: ParsedAnalysisSummary
  } | null
}

function recordPath(track: TrackRecord): string {
  return join(dirname(track.filePath), GENERATION_FILENAME)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function boundedValue(key: string, value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') {
    const limit = key === 'audio_codes' ? MAX_AUDIO_CODES : MAX_TEXT
    return value.length <= limit ? value : undefined
  }
  if (typeof value === 'boolean') return value
  if (finite(value)) return value
  return undefined
}

function fitRecipe(recipes: ResolvedGenerationRecipe[], recipe: ResolvedGenerationRecipe): boolean {
  return Buffer.byteLength(JSON.stringify([...recipes, recipe]), 'utf8') <= MAX_RESOLVED_BYTES
}

export function resolvedRecipes(text: string): ResolvedGenerationRecipe[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_GENERATION_BYTES) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const values: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  const recipes: ResolvedGenerationRecipe[] = []
  for (const candidate of values.slice(0, MAX_RECIPES)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const recipe: ResolvedGenerationRecipe = {}
    for (const [key, value] of Object.entries(candidate)) {
      if (!RECIPE_KEYS.has(key)) continue
      const bounded = boundedValue(key, value)
      if (bounded !== undefined) recipe[key] = bounded
    }
    if (Object.keys(recipe).length > 0 && fitRecipe(recipes, recipe)) recipes.push(recipe)
  }
  return recipes
}

function validPhase(value: GenerationPhaseTiming | null): boolean {
  return (
    !!value &&
    ['lm', 'synth', 'finishing'].includes(value.phase) &&
    finite(value.startedAt) &&
    finite(value.finishedAt) &&
    value.finishedAt >= value.startedAt &&
    value.durationMs === value.finishedAt - value.startedAt &&
    (value.engineJobId === undefined || typeof value.engineJobId === 'string')
  )
}

function validTrace(value: GenerationTraceEvent | null): boolean {
  return (
    !!value &&
    finite(value.at) &&
    ['started', 'phase_started', 'phase_finished', 'audio_validated'].includes(value.event) &&
    (value.phase === undefined || ['lm', 'synth', 'finishing'].includes(value.phase)) &&
    (value.engineJobId === undefined || typeof value.engineJobId === 'string')
  )
}

function validRecipe(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([key, candidate]) => RECIPE_KEYS.has(key) && boundedValue(key, candidate) === candidate
  )
}

function validRequest(value: ParsedRequest | null | undefined): boolean {
  if (
    !value ||
    typeof value.prompt !== 'string' ||
    value.prompt.length > MAX_TEXT ||
    !finite(value.durationSec) ||
    typeof value.preset !== 'string' ||
    (value.lyrics !== undefined &&
      (typeof value.lyrics !== 'string' || value.lyrics.length > MAX_REQUEST_LYRICS)) ||
    (value.seed !== undefined && !finite(value.seed))
  ) {
    return false
  }
  if (value.config === undefined) return true
  if (!value.config || typeof value.config !== 'object' || Array.isArray(value.config)) return false
  return Object.values(value.config).every(
    (candidate) =>
      candidate === undefined ||
      typeof candidate === 'boolean' ||
      finite(candidate) ||
      (typeof candidate === 'string' && candidate.length <= MAX_TEXT)
  )
}

const MAX_REQUEST_LYRICS = 32 * 1024

function validAnalysisSummary(value: ParsedAnalysisSummary | undefined): boolean {
  if (value === undefined) return true
  const audible = value.audible
  return (
    (!value.sourceSha256 || /^[a-f0-9]{64}$/.test(value.sourceSha256)) &&
    finite(value.peakAmplitude) &&
    value.peakAmplitude >= 0 &&
    finite(value.rmsAmplitude) &&
    value.rmsAmplitude >= 0 &&
    Number.isInteger(value.clippedSamples) &&
    value.clippedSamples >= 0 &&
    !!audible &&
    ['audible', 'silent', 'indeterminate'].includes(audible.classification) &&
    finite(audible.leadingSilenceSec) &&
    audible.leadingSilenceSec >= 0 &&
    finite(audible.trailingSilenceSec) &&
    audible.trailingSilenceSec >= 0 &&
    (audible.audibleDurationSec === undefined || finite(audible.audibleDurationSec))
  )
}

function validRecord(parsed: unknown): parsed is GenerationRecordV1 {
  const value = parsed as ParsedRecord | null
  if (
    value?.schema !== 1 ||
    typeof value.jobId !== 'string' ||
    !validRequest(value.request) ||
    !finite(value.startedAt) ||
    !finite(value.finishedAt) ||
    value.finishedAt < value.startedAt ||
    !value.engine ||
    typeof value.engine.pluginId !== 'string' ||
    (value.engine.pluginVersion !== null && typeof value.engine.pluginVersion !== 'string') ||
    !Array.isArray(value.phases) ||
    !value.phases.every(validPhase) ||
    !Array.isArray(value.trace) ||
    value.trace.length > MAX_TRACE_EVENTS ||
    !value.trace.every(validTrace) ||
    !Array.isArray(value.resolvedRecipes) ||
    value.resolvedRecipes.length > MAX_RECIPES ||
    !value.resolvedRecipes.every(validRecipe) ||
    value.result?.status !== 'done' ||
    typeof value.result.trackId !== 'string' ||
    value.result.format !== 'wav' ||
    value.output?.codec !== 'wav' ||
    !finite(value.output.sizeBytes) ||
    !value.output.audio ||
    !validAnalysisSummary(value.output.analysis)
  ) {
    return false
  }
  return value.output.sizeBytes === value.output.audio.containerBytes
}

async function persist(track: TrackRecord, record: GenerationRecordV1): Promise<void> {
  let text = JSON.stringify(record, null, 1)
  if (Buffer.byteLength(text, 'utf8') > MAX_GENERATION_BYTES && record.resolvedRecipes.length) {
    record.resolvedRecipes = []
    text = JSON.stringify(record, null, 1)
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_GENERATION_BYTES) {
    throw new Error('generation provenance exceeds its size limit')
  }
  const path = recordPath(track)
  const tmp = `${path}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(ignoreFailure)
    throw error
  }
}

export async function writeGenerationRecord(
  track: TrackRecord,
  evidence: GenerationEvidenceInput
): Promise<GenerationRecordV1> {
  const request = JSON.parse(JSON.stringify(evidence.request)) as GenerateRequest
  const effective = resolvedRecipes(JSON.stringify([evidence.effectiveRequest]))[0] ?? {}
  const actual = resolvedRecipes(evidence.resolvedSynthText)
  const recipes = (actual.length ? actual : [{}]).flatMap((recipe) => {
    const merged = { ...effective, ...recipe }
    return fitRecipe([], merged) ? [merged] : []
  })
  const audio = track.audio
  if (!audio) throw new Error('invalid generation provenance')
  const record: GenerationRecordV1 = {
    schema: 1,
    jobId: evidence.jobId,
    request,
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt,
    engine: { pluginId: evidence.engine.id, pluginVersion: evidence.engine.version },
    phases: evidence.phases.slice(0, 3),
    trace: evidence.trace.slice(0, MAX_TRACE_EVENTS),
    resolvedRecipes: recipes,
    result: { status: 'done', trackId: track.id, format: 'wav' },
    output: { codec: 'wav', sizeBytes: audio.containerBytes, audio }
  }
  if (!validRecord(record)) throw new Error('invalid generation provenance')
  await persist(track, record)
  return record
}

export async function readGenerationRecord(track: TrackRecord): Promise<GenerationRecordV1 | null> {
  const path = recordPath(track)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const size = (await handle.stat()).size
    if (size > MAX_GENERATION_BYTES) return null
    const bytes = Buffer.alloc(size)
    const { bytesRead } = await handle.read(bytes, 0, size, 0)
    if (bytesRead !== size) return null
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    if (!validRecord(parsed) || parsed.result.trackId !== track.id) return null
    const expected = track.audio
    if (!expected) return null
    if (
      Object.keys(parsed.output.audio).length !== Object.keys(expected).length ||
      Object.keys(expected).some(
        (key) =>
          parsed.output.audio[key as keyof typeof expected] !==
          expected[key as keyof typeof expected]
      )
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  } finally {
    await handle?.close().catch(ignoreFailure)
  }
}

async function serialize(trackId: string, mutation: () => Promise<void>): Promise<void> {
  const previous = mutations.get(trackId) ?? Promise.resolve()
  const next = previous.catch(ignoreFailure).then(mutation)
  mutations.set(trackId, next)
  try {
    await next
  } finally {
    if (mutations.get(trackId) === next) mutations.delete(trackId)
  }
}

export async function addGenerationAnalysis(
  track: TrackRecord,
  analysis: AudioAnalysis,
  sourceSha256?: string
): Promise<void> {
  await serialize(track.id, async () => {
    const record = await readGenerationRecord(track)
    if (!record) return
    if (!sourceSha256) {
      try {
        const persisted = JSON.parse(
          await readFile(join(dirname(track.filePath), 'analysis.v1.json'), 'utf8')
        ) as { identity?: { sha256?: unknown } }
        if (typeof persisted.identity?.sha256 === 'string') sourceSha256 = persisted.identity.sha256
      } catch {
        // Analysis facts remain useful even if its identity sidecar cannot be read.
      }
    }
    record.output.analysis = {
      ...(sourceSha256 && /^[a-f0-9]{64}$/.test(sourceSha256) ? { sourceSha256 } : {}),
      peakAmplitude: analysis.peakAmplitude,
      rmsAmplitude: analysis.rmsAmplitude,
      clippedSamples: analysis.clippedSamples,
      audible: analysis.audible
    }
    await persist(track, record)
  })
}
