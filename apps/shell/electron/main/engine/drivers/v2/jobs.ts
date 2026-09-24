// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The v2 job client: drives POST /v2/jobs + polling against a contract-v2
// sidecar and exposes the same v1 JobState surface the queue already speaks.
// Everything the sidecar reports is hostile until the SDK parsers and the
// host's own file revalidation accept it: outputs are re-resolved, contained,
// reopened, and re-parsed before a byte reaches the Library.
//
// All side-effecting deps are injected so the state machine unit-tests
// against a real fixture process without Electron.

import { mkdir, readFile, rm, lstat, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  parseEngineJobOutputsV2,
  parseEngineJobStateV2,
  type EngineDescriptorV2,
  type EngineJobStateV2,
  type EngineRecipeV2,
  type GenerateRequest,
  type JobState,
  type JobStatus
} from '@iblis/plugin-sdk'
import type { WavMetadata } from '../../../media/wav'
import { parseWav } from '../../../media/wav'
import { operationOf } from './request'
import { ignoreFailure } from '../../../ignore-failure'
import { errorMessage } from '../../../error-message'

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024
const TERMINAL_CAP = 64

class EngineV2Error extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export interface V2JobContext {
  engine: { id: string; version: string }
  recipe: EngineRecipeV2
  descriptor: EngineDescriptorV2
}

// Extra outputs retained beside the mix, by role.
export type KeptOutputs = Partial<Record<'preview', string>>

export interface V2JobDeps {
  fetch(engineId: string, path: string, init?: RequestInit): Promise<Response>
  // Resolve recipe + descriptor for the exact installed target, bringing the
  // sidecar up on demand first; throws actionably when the target drifted.
  prepare(request: GenerateRequest): Promise<V2JobContext>
  stagingRoot(): string
  writeWav(
    jobId: string,
    bytes: Buffer,
    req: GenerateRequest,
    metadata: WavMetadata,
    engine: { id: string; version: string | null }
  ): Promise<{ trackId: string }>
  // Keep a validated non-mix output beside the track (preview today). Absent
  // = the host does not retain that role; the file is still contained-proven.
  writeExtra?(trackId: string, role: 'preview', bytes: Buffer): Promise<boolean>
  writeEvidence?(
    trackId: string,
    jobId: string,
    context: V2JobContext,
    timing: V2PhaseWindow[],
    kept: KeptOutputs
  ): Promise<void>
  // Called when the driver goes idle so the lifecycle owner can arm unload.
  onIdle?(engineId: string): void
  makeId?: () => string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  jobTimeoutMs?: number
}

export interface V2PhaseWindow {
  phase: string
  startedAt: number
  finishedAt: number
}

interface LiveJob {
  engineId: string | null
  engineJobId: string | null
  cancelled: boolean
  aborted?: EngineV2Error
}

// v2 wire statuses map onto the v1 vocabulary the queue/UI already render:
// running shows as the synthesis phase, done passes through finishing while
// the host ingests outputs.
function v1Status(status: string): JobStatus {
  if (status === 'queued') return 'queued'
  if (status === 'running') return 'synth'
  return 'finishing'
}

export interface EngineV2Client {
  generate(req: GenerateRequest): { jobId: string }
  jobState(jobId: string): JobState | undefined
  settled(jobId: string): Promise<JobState | undefined>
  cancel(jobId: string): Promise<boolean>
  abortActive(code: string, message: string): Promise<string | null>
  hasLiveJobs(): boolean
}

export function createEngineV2Client(deps: V2JobDeps): EngineV2Client {
  const makeId = deps.makeId ?? (() => crypto.randomUUID())
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const pollIntervalMs = deps.pollIntervalMs ?? 500
  const jobTimeoutMs = deps.jobTimeoutMs ?? 20 * 60_000

  const jobs = new Map<string, JobState>()
  const live = new Map<string, LiveJob>()
  const settlements = new Map<
    string,
    { promise: Promise<JobState | undefined>; resolve: (state: JobState | undefined) => void }
  >()
  const terminalOrder: string[] = []

  function set(jobId: string, status: JobStatus, patch: Partial<JobState> = {}): void {
    const progress = status === 'done' ? 1 : (patch.progress ?? jobs.get(jobId)?.progress ?? 0)
    jobs.set(jobId, { status, progress, ...patch })
  }

  function checkStopped(job: LiveJob, label: string): void {
    if (job.aborted) throw job.aborted
    if (job.cancelled) throw new EngineV2Error('job_cancelled', `${label} stopped`)
  }

  async function post(engineId: string, path: string, body: unknown): Promise<unknown> {
    const res = await deps.fetch(engineId, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new EngineV2Error('post_failed', `${path} answered HTTP ${res.status}`)
    return res.json()
  }

  // Resolve one declared output to a real, contained, ordinary file. The
  // SDK's path parser already refused traversal text; this re-proves it on
  // the real filesystem so a symlinked directory cannot smuggle a read.
  async function containedFile(staging: string, relative: string): Promise<string> {
    const stagingReal = await realpath(staging)
    const candidate = resolve(stagingReal, relative)
    if (candidate !== stagingReal && !candidate.startsWith(stagingReal + sep)) {
      throw new EngineV2Error('output_escaped', 'engine output escaped its staging directory')
    }
    const facts = await lstat(candidate)
    if (facts.isSymbolicLink() || !facts.isFile()) {
      throw new EngineV2Error('output_escaped', 'engine output is not an ordinary file')
    }
    const real = await realpath(candidate)
    if (real !== stagingReal && !real.startsWith(stagingReal + sep)) {
      throw new EngineV2Error('output_escaped', 'engine output escaped its staging directory')
    }
    if (facts.size > MAX_OUTPUT_BYTES) {
      throw new EngineV2Error('output_too_large', 'engine output exceeds the size cap')
    }
    return real
  }

  async function pollJob(
    context: V2JobContext,
    job: LiveJob,
    jobId: string,
    phases: V2PhaseWindow[]
  ): Promise<EngineJobStateV2> {
    const deadline = now() + jobTimeoutMs
    const path = `/v2/jobs/${encodeURIComponent(job.engineJobId ?? '')}`
    for (;;) {
      checkStopped(job, 'engine job')
      if (now() > deadline) throw new EngineV2Error('timeout', 'engine job timed out')
      const res = await deps.fetch(context.engine.id, path)
      if (!res.ok) throw new EngineV2Error('poll_failed', `${path} answered HTTP ${res.status}`)
      const parsed = parseEngineJobStateV2(await res.json(), context.descriptor)
      if (!parsed.ok) throw new EngineV2Error('bad_job_state', parsed.errors[0] ?? 'invalid state')
      const state = parsed.value
      const at = now()
      const current = phases[phases.length - 1]
      if (state.phase && current?.phase !== state.phase) {
        if (current) current.finishedAt = at
        phases.push({ phase: state.phase, startedAt: at, finishedAt: at })
      }
      if (state.status === 'error') {
        throw new EngineV2Error(state.error?.code ?? 'engine_error', state.error?.message ?? '')
      }
      if (state.status === 'cancelled') {
        throw new EngineV2Error('job_cancelled', 'engine reported the job cancelled')
      }
      if (state.status === 'done') {
        if (current) current.finishedAt = at
        return state
      }
      set(jobId, v1Status(state.status), { progress: state.progress })
      await sleep(pollIntervalMs)
    }
  }

  // Submit the recipe and record the engine's job id; a cancel that landed
  // before the id existed is forwarded now.
  async function startJob(context: V2JobContext, job: LiveJob, jobId: string, staging: string) {
    await mkdir(staging, { recursive: true })
    set(jobId, 'queued')
    const started = (await post(context.engine.id, '/v2/jobs', {
      recipe: context.recipe,
      staging
    })) as { jobId?: unknown }
    if (typeof started.jobId !== 'string' || started.jobId.length === 0) {
      throw new EngineV2Error('bad_response', 'engine did not return a job id')
    }
    job.engineJobId = started.jobId
    if (job.cancelled || job.aborted) {
      await post(context.engine.id, `/v2/jobs/${encodeURIComponent(started.jobId)}/cancel`, {})
    }
    set(jobId, 'synth', { progress: 0 })
  }

  // Revalidate every declared output, ingest the mix, keep the preview.
  async function ingestOutputs(
    jobId: string,
    request: GenerateRequest,
    context: V2JobContext,
    state: EngineJobStateV2,
    staging: string,
    phases: V2PhaseWindow[]
  ): Promise<string> {
    const operation = operationOf(context.descriptor)
    const outputs = parseEngineJobOutputsV2(state.outputs, operation)
    if (!outputs.ok) {
      throw new EngineV2Error('bad_outputs', outputs.errors[0] ?? 'invalid outputs')
    }
    const mix = outputs.value.find((output) => output.role === 'mix')
    if (!mix) throw new EngineV2Error('no_mix', 'engine returned no mix output')
    // Every declared output must survive containment even if only the mix
    // is ingested today — a hostile preview path is still a violation.
    const files = new Map<string, string>()
    for (const output of outputs.value) {
      files.set(output.role, await containedFile(staging, output.path))
    }
    const mixPath = files.get('mix')
    if (!mixPath) throw new EngineV2Error('no_mix', 'engine returned no mix output')
    const bytes = await readFile(mixPath)
    const metadata = parseWav(bytes)
    const result = await deps.writeWav(jobId, bytes, request, metadata, {
      id: context.engine.id,
      version: context.engine.version
    })
    const kept: KeptOutputs = {}
    const preview = files.get('preview')
    if (preview && deps.writeExtra) {
      const previewBytes = await readFile(preview)
      parseWav(previewBytes)
      if (await deps.writeExtra(result.trackId, 'preview', previewBytes)) {
        kept.preview = 'preview.wav'
      }
    }
    await deps.writeEvidence?.(result.trackId, jobId, context, phases, kept)
    return result.trackId
  }

  // An abort reason wins over a user cancel, which wins over the thrown error.
  function recordFailure(jobId: string, job: LiveJob, e: unknown) {
    const failure =
      job.aborted ??
      (job.cancelled
        ? new EngineV2Error('job_cancelled', 'generation stopped')
        : e instanceof EngineV2Error
          ? e
          : new EngineV2Error('engine_error', errorMessage(e)))
    const progress = jobs.get(jobId)?.progress ?? 0
    jobs.set(jobId, {
      status: 'error',
      progress,
      error: { code: failure.code, message: failure.message }
    })
  }

  async function settle(jobId: string, job: LiveJob, staging: string) {
    await rm(staging, { recursive: true, force: true }).catch(ignoreFailure)
    live.delete(jobId)
    settlements.get(jobId)?.resolve(jobs.get(jobId))
    terminalOrder.push(jobId)
    while (terminalOrder.length > TERMINAL_CAP) {
      const expired = terminalOrder.shift()
      if (expired) {
        jobs.delete(expired)
        settlements.delete(expired)
      }
    }
    if (live.size === 0 && job.engineId) deps.onIdle?.(job.engineId)
  }

  async function drive(jobId: string, request: GenerateRequest): Promise<void> {
    const job = live.get(jobId) ?? { engineId: null, engineJobId: null, cancelled: false }
    const staging = join(deps.stagingRoot(), jobId)
    const phases: V2PhaseWindow[] = []
    try {
      const context = await deps.prepare(request)
      job.engineId = context.engine.id
      checkStopped(job, 'engine job')
      await startJob(context, job, jobId, staging)
      const state = await pollJob(context, job, jobId, phases)
      set(jobId, 'finishing')
      const trackId = await ingestOutputs(jobId, request, context, state, staging, phases)
      set(jobId, 'done', { result: { trackId, format: 'wav' } })
    } catch (e) {
      recordFailure(jobId, job, e)
    } finally {
      await settle(jobId, job, staging)
    }
  }

  return {
    generate(req: GenerateRequest): { jobId: string } {
      if (live.size > 0) {
        throw new EngineV2Error('engine_busy', 'the engine already has an active job')
      }
      const jobId = makeId()
      set(jobId, 'queued')
      let resolveSettled!: (state: JobState | undefined) => void
      const promise = new Promise<JobState | undefined>((done) => (resolveSettled = done))
      settlements.set(jobId, { promise, resolve: resolveSettled })
      live.set(jobId, { engineId: null, engineJobId: null, cancelled: false })
      queueMicrotask(() => void drive(jobId, req))
      return { jobId }
    },
    jobState: (jobId) => jobs.get(jobId),
    settled: (jobId) => settlements.get(jobId)?.promise ?? Promise.resolve(jobs.get(jobId)),
    async cancel(jobId: string): Promise<boolean> {
      const job = live.get(jobId)
      if (!job) return false
      job.cancelled = true
      if (job.engineId && job.engineJobId) {
        await post(
          job.engineId,
          `/v2/jobs/${encodeURIComponent(job.engineJobId)}/cancel`,
          {}
        ).catch(ignoreFailure)
      }
      return true
    },
    async abortActive(code: string, message: string): Promise<string | null> {
      const current = live.entries().next().value
      if (!current) return null
      const [jobId, job] = current
      job.aborted = new EngineV2Error(code, message)
      if (job.engineId && job.engineJobId) {
        await post(
          job.engineId,
          `/v2/jobs/${encodeURIComponent(job.engineJobId)}/cancel`,
          {}
        ).catch(ignoreFailure)
      }
      return jobId
    },
    hasLiveJobs: () => live.size > 0
  }
}
