// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Host-side engine client: drives the real ace-server two-phase protocol and
// exposes the clean SDK engine contract (GenerateRequest -> jobId, JobState
// polling) to the rest of the app. The renderer never sees /lm, /synth, the
// multipart carve, or the 404-until-done quirk — this module is the bridge.
//
// All side-effecting deps are injected (the sidecar fetch, the WAV writer, the
// clock, id + sleep), so the whole state machine unit-tests headlessly against
// a mock ace-server. The Electron wiring lives in ./index.ts.

import type { GenerateRequest, GenerateResponse, JobState, JobStatus } from '@iblis/plugin-sdk'
import {
  EngineError,
  carveWav,
  isTerminalFailure,
  lmBody,
  parseJobId,
  synthBody,
  validComparisonBlueprint
} from './protocol'
import { createEngineTransport, type LiveTransportJob, type SidecarFetch } from './transport'
import {
  createGenerationPhaseRecorder,
  type EngineGenerationEvidence,
  type GenerationEngineIdentity,
  type GenerationPhaseRecorder
} from './evidence'
import type { WavMetadata } from '../../../media/wav'
import { ignoreFailure } from '../../../ignore-failure'
import { errorMessage } from '../../../error-message'

export interface EngineDeps {
  // Authenticated request to the running engine sidecar (requestSidecar's shape).
  fetch: SidecarFetch
  // Persist a finished track's bytes (the request rides along so the library
  // can record prompt/seed/preset); returns the on-disk path for JobResult.
  writeWav: (
    jobId: string,
    bytes: Buffer,
    req: GenerateRequest,
    metadata: WavMetadata,
    engine: GenerationEngineIdentity
  ) => Promise<{ trackId: string }>
  writeEvidence?: (trackId: string, evidence: EngineGenerationEvidence) => Promise<void>
  makeId?: () => string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  lmTimeoutMs?: number
  synthTimeoutMs?: number
  cancelTimeoutMs?: number
}

// Coarse progress per phase — ace-server reports running/done, not a fraction,
// so we step the bar at phase boundaries rather than fake granularity.
const PROGRESS: Record<JobStatus, number> = {
  queued: 0,
  lm: 0.1,
  synth: 0.5,
  finishing: 0.9,
  done: 1,
  error: 0
}

export interface EngineClient {
  generate(
    req: GenerateRequest,
    engine?: GenerationEngineIdentity,
    blueprint?: string
  ): GenerateResponse
  jobState(jobId: string): JobState | undefined
  // Resolves only after drive() has removed its live entry and all completion
  // persistence has settled. Queue scheduling must wait on this boundary.
  settled(jobId: string): Promise<JobState | undefined>
  // Stop a running job. Resolves true if the job was live (cancel delivered or
  // at least flagged), false if it was unknown/already terminal. Idempotent.
  cancel(jobId: string): Promise<boolean>
  // Abort the one live chain for an infrastructure reason (sidecar loss,
  // hot-swap, shutdown). Unlike user cancel, the stable code is preserved.
  abortActive(code: string, message: string): Promise<string | null>
  blueprint(jobId: string): string | undefined
}

// Book-keeping for a job whose drive() chain is still running: the engine-side
// id of the phase currently in flight (ace-server mints one per /lm and /synth
// POST — cancel needs THAT id, not our shell jobId) and a cancelled flag the
// chain checks at every await point. Entries live exactly as long as drive().
interface LiveJob extends LiveTransportJob {
  engineId: string | null
}

export function createEngineClient(deps: EngineDeps): EngineClient {
  const makeId = deps.makeId ?? (() => crypto.randomUUID())
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const pollIntervalMs = deps.pollIntervalMs ?? 1000
  const lmTimeoutMs = deps.lmTimeoutMs ?? 5 * 60_000
  const synthTimeoutMs = deps.synthTimeoutMs ?? 20 * 60_000
  const cancelTimeoutMs = deps.cancelTimeoutMs ?? 5000
  const transport = createEngineTransport(deps.fetch, now, cancelTimeoutMs)

  const jobs = new Map<string, JobState>()
  const live = new Map<string, LiveJob>()
  const settlements = new Map<
    string,
    { promise: Promise<JobState | undefined>; resolve: (state: JobState | undefined) => void }
  >()
  const terminalOrder: string[] = []
  const blueprints = new Map<string, string>()

  function set(jobId: string, status: JobStatus, patch: Partial<JobState> = {}): void {
    jobs.set(jobId, { status, progress: PROGRESS[status], ...patch })
  }

  // POST a JSON body to a job-starting endpoint, return its job id.
  async function startJob(
    job: LiveJob,
    path: string,
    body: unknown,
    deadline: number,
    label: string
  ): Promise<string> {
    return transport.request(
      job,
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      async (res) => {
        if (!res.ok) throw new EngineError('post_failed', `${path} -> HTTP ${res.status}`)
        return parseJobId(await res.json())
      },
      deadline,
      label
    )
  }

  // cancel()/abort() mutate a LiveJob while an await is pending, but TS keeps a
  // property narrowed across awaits, so post-await re-checks read through this.
  function stopFlags(job: LiveJob): { aborted?: EngineError; cancelled: boolean } {
    return { aborted: job.aborted, cancelled: job.cancelled }
  }

  // Start a phase, recording its engine-side id so cancel() can target it.
  // A cancel that lands while the POST is in flight targeted the previous
  // phase's id (or none), so re-issue it against the id we just created —
  // otherwise the fresh job would keep burning the GPU/CPU unobserved.
  async function startPhase(
    job: LiveJob,
    path: string,
    body: unknown,
    deadline: number,
    label: string
  ): Promise<string> {
    if (job.aborted) throw job.aborted
    if (job.cancelled) throw new EngineError('job_cancelled', `${path} skipped — job stopped`)
    const id = await startJob(job, path, body, deadline, label)
    job.engineId = id
    const stop = stopFlags(job)
    if (stop.aborted) {
      await transport.cancelUpstream(id).catch(ignoreFailure)
      throw stop.aborted
    }
    if (stop.cancelled) {
      await transport.cancelUpstream(id).catch(ignoreFailure)
      throw new EngineError('job_cancelled', `${path} stopped at start`)
    }
    return id
  }

  // Poll GET /job?id=&result=1 until it answers 200 with a body (== DONE),
  // fast-failing if the status endpoint reports a terminal-but-not-done state
  // or the job was stopped shell-side (covers an engine that lost the cancel).
  async function pollResult(
    id: string,
    deadline: number,
    label: string,
    job: LiveJob
  ): Promise<Buffer> {
    const q = encodeURIComponent(id)
    while (now() < deadline) {
      if (job.aborted) throw job.aborted
      if (job.cancelled) throw new EngineError('job_cancelled', `${label} job stopped`)
      const result = await transport.request(
        job,
        `/job?id=${q}&result=1`,
        {},
        async (res) => ({
          status: res.status,
          bytes: res.status === 200 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0)
        }),
        deadline,
        label
      )
      if (result.status === 200 && result.bytes.length > 0) {
        return result.bytes
      }
      // FAILED/CANCELLED also answer 404 on result=1, so probe the status
      // endpoint to avoid polling a dead job to the timeout.
      const st = await transport.request(
        job,
        `/job?id=${q}`,
        {},
        async (res) => ({
          ok: res.ok,
          body: res.ok ? await res.json().catch(() => null) : null
        }),
        deadline,
        label
      )
      if (st.ok) {
        const status = (st.body as { status?: string } | null)?.status
        if (isTerminalFailure(status)) {
          throw new EngineError(`job_${(status ?? '').toLowerCase()}`, `${label} job ${status}`)
        }
      }
      await sleep(pollIntervalMs)
    }
    throw new EngineError('timeout', `${label} job timed out`)
  }

  // Caption phase: either replay a comparison blueprint or run /lm. The
  // result text is the blueprint the synth phase consumes.
  async function runLm(
    jobId: string,
    job: LiveJob,
    req: GenerateRequest,
    recorder: GenerationPhaseRecorder,
    reusedBlueprint: string | undefined
  ) {
    set(jobId, 'lm')
    recorder.start('lm')
    const effectiveRequest = lmBody(req)
    let lmResult: Buffer
    if (reusedBlueprint !== undefined) {
      if (!validComparisonBlueprint(reusedBlueprint)) {
        throw new EngineError('bad_blueprint', 'comparison blueprint is invalid')
      }
      lmResult = Buffer.from(reusedBlueprint, 'utf8')
    } else {
      const lmDeadline = now() + lmTimeoutMs
      const lmId = await startPhase(job, '/lm', effectiveRequest, lmDeadline, 'lm')
      recorder.setEngineJobId(lmId)
      lmResult = await pollResult(lmId, lmDeadline, 'lm', job)
    }
    const lmResultText = lmResult.toString('utf8')
    if (validComparisonBlueprint(lmResultText)) blueprints.set(jobId, lmResultText)
    recorder.finish()
    return { effectiveRequest, lmResultText }
  }

  async function runSynth(
    jobId: string,
    job: LiveJob,
    req: GenerateRequest,
    lmResultText: string,
    recorder: GenerationPhaseRecorder
  ) {
    set(jobId, 'synth')
    recorder.start('synth')
    const synthDeadline = now() + synthTimeoutMs
    const resolvedSynth = synthBody(lmResultText, 'wav32', req)
    const synthId = await startPhase(job, '/synth', resolvedSynth, synthDeadline, 'synth')
    recorder.setEngineJobId(synthId)
    const synthBytes = await pollResult(synthId, synthDeadline, 'synth', job)
    recorder.finish()
    return { resolvedSynth, synthBytes }
  }

  // An abort reason wins over a user cancel, which wins over the thrown error.
  function recordFailure(jobId: string, job: LiveJob, e: unknown) {
    const err =
      job.aborted ??
      (job.cancelled
        ? new EngineError('job_cancelled', 'generation stopped')
        : e instanceof EngineError
          ? e
          : new EngineError('engine_error', errorMessage(e)))
    const progress = jobs.get(jobId)?.progress ?? 0
    jobs.set(jobId, {
      status: 'error',
      progress,
      error: { code: err.code, message: err.message }
    })
  }

  function settle(jobId: string) {
    live.delete(jobId)
    settlements.get(jobId)?.resolve(jobs.get(jobId))
    terminalOrder.push(jobId)
    while (terminalOrder.length > 64) {
      const expired = terminalOrder.shift()
      if (expired) {
        jobs.delete(expired)
        settlements.delete(expired)
        blueprints.delete(expired)
      }
    }
  }

  // Run the full caption -> codes -> audio chain, updating job state as it goes.
  // Fire-and-forget from generate(); failures land in the job's error field.
  async function drive(
    jobId: string,
    req: GenerateRequest,
    engineIdentity: GenerationEngineIdentity,
    reusedBlueprint?: string
  ): Promise<void> {
    const job = live.get(jobId) ?? { engineId: null, cancelled: false }
    const recorder = createGenerationPhaseRecorder(now)
    try {
      const lm = await runLm(jobId, job, req, recorder, reusedBlueprint)
      const { resolvedSynth, synthBytes } = await runSynth(
        jobId,
        job,
        req,
        lm.lmResultText,
        recorder
      )

      set(jobId, 'finishing')
      recorder.start('finishing')
      const wav = carveWav(synthBytes)
      recorder.trace.push({ at: now(), event: 'audio_validated', phase: 'finishing' })
      const result = await deps.writeWav(jobId, wav.bytes, req, wav.metadata, engineIdentity)
      recorder.finish()
      const evidence: EngineGenerationEvidence = {
        jobId,
        request: req,
        startedAt: recorder.startedAt,
        finishedAt: now(),
        phases: recorder.phases,
        trace: recorder.trace,
        resolvedSynthText: JSON.stringify(resolvedSynth),
        effectiveRequest: lm.effectiveRequest,
        engine: engineIdentity
      }
      await deps.writeEvidence?.(result.trackId, evidence)
      set(jobId, 'done', { result: { trackId: result.trackId, format: 'wav' } })
    } catch (e) {
      recordFailure(jobId, job, e)
    } finally {
      settle(jobId)
    }
  }

  return {
    generate(
      req: GenerateRequest,
      engineIdentity: GenerationEngineIdentity = { id: 'unknown', version: null },
      blueprint?: string
    ): GenerateResponse {
      if (live.size > 0)
        throw new EngineError('engine_busy', 'the engine already has an active job')
      const jobId = makeId()
      set(jobId, 'queued')
      let resolve!: (state: JobState | undefined) => void
      const promise = new Promise<JobState | undefined>((done) => (resolve = done))
      settlements.set(jobId, { promise, resolve })
      // Registered before the deferred drive() so a cancel that arrives while
      // the job is still 'queued' has something to flag.
      live.set(jobId, { engineId: null, cancelled: false })
      // Defer the I/O chain to the next tick so generate() returns instantly in
      // the 'queued' state (no synchronous fetch before the caller has the id).
      queueMicrotask(() => void drive(jobId, req, engineIdentity, blueprint))
      return { jobId }
    },
    jobState(jobId: string): JobState | undefined {
      return jobs.get(jobId)
    },
    settled(jobId: string): Promise<JobState | undefined> {
      return settlements.get(jobId)?.promise ?? Promise.resolve(jobs.get(jobId))
    },
    async cancel(jobId: string): Promise<boolean> {
      const job = live.get(jobId)
      if (!job) return false
      job.cancelled = true
      transport.abortRequest(job)
      if (job.engineId) await transport.cancelUpstream(job.engineId).catch(ignoreFailure)
      return true
    },
    async abortActive(code: string, message: string): Promise<string | null> {
      const current = live.entries().next().value
      if (!current) return null
      const [jobId, job] = current
      job.aborted = new EngineError(code, message)
      transport.abortRequest(job)
      if (job.engineId) await transport.cancelUpstream(job.engineId).catch(ignoreFailure)
      return jobId
    },
    blueprint(jobId: string): string | undefined {
      return blueprints.get(jobId)
    }
  }
}
