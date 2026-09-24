// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { ProcessorAnalysisCapability, ProcessorErrorV1 } from '@iblis/plugin-sdk'
import type {
  ProcessorBenchmarkView,
  ProcessorJobView,
  ProcessorResultRecord,
  ProcessorSettings
} from '../../../shared/processors'
import type { ProcessorSidecarClient } from './client'
import type { ProcessorJob, ProcessorStore } from './store'
import {
  createProcessorBenchmark,
  processorBenchmarkView,
  type BenchmarkInput,
  type BenchmarkProvider
} from './benchmark'
import { canonicalJson, processorConfigHash } from './config'
import { processorError, processorFailure } from './errors'
import { resultRecords, type DoneState } from './results'
import { assertProcessorDefault, providerAcknowledgement } from './selection'
import { ignoreFailure } from '../ignore-failure'

const MAX_ATTEMPTS = 3
const POLL_MS = 500

export type ProcessorProvider = BenchmarkProvider
export type ProcessorInput = BenchmarkInput

export interface ProcessorSchedulerDeps {
  store: ProcessorStore
  provider: (id: string) => ProcessorProvider | null
  input: (trackId: string) => Promise<ProcessorInput | null>
  client(providerId: string): ProcessorSidecarClient
  mayRun(): Promise<boolean>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  hash?: (path: string) => Promise<string>
  makeId?: () => string
}

export interface ProcessorScheduler {
  initialize(): Promise<void>
  enqueue(trackId: string, capabilities?: ProcessorAnalysisCapability[]): Promise<void>
  retry(trackId: string, capability: ProcessorAnalysisCapability): Promise<void>
  cancelTrack(trackId: string): Promise<void>
  acquirePluginMutation(id: string): Promise<() => Promise<void>>
  results(trackId: string): ProcessorResultRecord[]
  allResults(): ProcessorResultRecord[]
  jobs(trackId: string): ProcessorJobView[]
  benchmarks(): ProcessorBenchmarkView[]
  benchmark(trackId: string, providerIds: string[]): Promise<ProcessorBenchmarkView>
  settings(): ProcessorSettings
  setDefault(capability: ProcessorAnalysisCapability, pluginId?: string): Promise<ProcessorSettings>
  acknowledge(id: string): Promise<ProcessorSettings>
}

export function createProcessorScheduler(deps: ProcessorSchedulerDeps): ProcessorScheduler {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const hash =
    deps.hash ??
    (async (path) =>
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'))
  const makeId = deps.makeId ?? (() => crypto.randomUUID())
  const cancelled = new Set<string>()
  const mutations = new Set<string>()
  let initialized = false
  let active: ProcessorJob | null = null
  let pumping = false

  function update(job: ProcessorJob, patch: Partial<ProcessorJob>): ProcessorJob {
    return { ...job, ...patch, updatedAt: now() }
  }

  async function stop(
    job: ProcessorJob,
    status: 'error' | 'cancelled',
    error: ProcessorErrorV1
  ): Promise<null> {
    await deps.store.saveJob(update(job, { status, error }))
    return null
  }

  // Everything that must hold before a job may start; a failed check is
  // persisted on the job and yields null.
  async function preflight(
    job: ProcessorJob
  ): Promise<{ provider: ProcessorProvider; input: ProcessorInput; sourceSha256: string } | null> {
    const provider = deps.provider(job.pluginId)
    if (provider?.version !== job.pluginVersion || mutations.has(job.pluginId)) {
      return stop(job, 'error', {
        code: 'provider_unavailable',
        message: 'selected processor is unavailable',
        retryable: true
      })
    }
    const input = await deps.input(job.trackId)
    if (input?.format.toLowerCase() !== 'wav') {
      return stop(job, 'cancelled', {
        code: 'source_unavailable',
        message: 'track audio is unavailable',
        retryable: false
      })
    }
    const sourceSha256 = await hash(input.audioPath)
    if (sourceSha256 !== job.sourceSha256) {
      return stop(job, 'error', {
        code: 'source_changed',
        message: 'track audio changed before analysis',
        retryable: true
      })
    }
    return { provider, input, sourceSha256 }
  }

  // Polls a started job until the sidecar reports it done (returned) or it is
  // cancelled from either side (persisted here, null returned).
  async function poll(
    running: ProcessorJob,
    client: ProcessorSidecarClient,
    providerId: string
  ): Promise<DoneState | null> {
    for (;;) {
      if (cancelled.has(running.id) || mutations.has(providerId)) {
        await client.cancel(running.id).catch(ignoreFailure)
        await deps.store.saveJob(update(running, { status: 'cancelled' }))
        return null
      }
      const state = await client.state(running.id)
      // A switch (not an if chain) so both the compiler and the linter see
      // that only 'done' leaves the loop with results.
      switch (state.status) {
        case 'queued':
        case 'running':
          await deps.store.saveJob(update(running, { status: 'running', progress: state.progress }))
          await sleep(POLL_MS)
          continue
        case 'cancelled':
          await deps.store.saveJob(
            update(running, { status: 'cancelled', progress: state.progress })
          )
          return null
        case 'error':
          throw processorFailure(state.error)
        case 'done':
          return state
        default:
          throw new Error('processor returned an unknown terminal state')
      }
    }
  }

  async function run(job: ProcessorJob): Promise<void> {
    const ready = await preflight(job)
    if (!ready) return
    const { provider, input, sourceSha256 } = ready
    const client = deps.client(provider.id)
    const running = update(job, { status: 'running', progress: 0, attempts: job.attempts + 1 })
    await deps.store.saveJob(running)
    const started = now()
    try {
      await client.start({
        protocolVersion: 1,
        jobId: running.id,
        input: { trackId: input.id, audioPath: input.audioPath, sourceSha256 },
        capabilities: running.capabilities as
          ['bpm-detect'] | ['key-detect'] | ['bpm-detect', 'key-detect'],
        ...(Object.keys(running.config).length ? { config: running.config } : {})
      })
      const done = await poll(running, client, provider.id)
      if (!done) return
      const beforePersistence = await hash(input.audioPath)
      if (beforePersistence !== sourceSha256)
        throw processorFailure({
          code: 'source_changed',
          message: 'track audio changed during analysis',
          retryable: true
        })
      const computedAt = now()
      const results = resultRecords(running, done, {
        pluginId: provider.id,
        pluginVersion: provider.version,
        resultSchema: 1,
        sourceSha256,
        configHash: running.configHash,
        computedAt,
        computeMs: Math.max(0, computedAt - started)
      })
      await deps.store.saveResults(results)
      await deps.store.saveJob(update(running, { status: 'done', progress: 1 }))
    } catch (error) {
      const failure = processorError(error)
      const attempts = running.attempts
      await deps.store.saveJob(
        update(running, {
          status: failure.retryable && attempts < MAX_ATTEMPTS ? 'queued' : 'error',
          error: failure
        })
      )
    }
  }

  async function pump(): Promise<void> {
    if (pumping || active || !initialized) return
    pumping = true
    try {
      for (;;) {
        if (!(await deps.mayRun())) {
          setTimeout(() => void pump(), POLL_MS)
          return
        }
        const next = deps.store
          .jobs()
          .find((job) => job.status === 'queued' && !mutations.has(job.pluginId))
        if (!next) return
        active = next
        await run(next)
        active = null
      }
    } finally {
      active = null
      pumping = false
    }
  }

  async function createJobs(
    trackId: string,
    capabilities?: ProcessorAnalysisCapability[],
    manual = false
  ): Promise<void> {
    const input = await deps.input(trackId)
    if (input?.format.toLowerCase() !== 'wav') return
    const identity = await hash(input.audioPath)
    const settings = deps.store.settings()
    const grouped = new Map<string, ProcessorAnalysisCapability[]>()
    for (const capability of capabilities ?? ['bpm-detect', 'key-detect']) {
      const providerId = settings.defaults[capability]
      const provider = providerId ? deps.provider(providerId) : null
      if (!providerId || !provider?.capabilities.includes(capability)) continue
      const existing = deps.store
        .results(trackId)
        .some(
          (result) =>
            result.capability === capability &&
            result.pluginId === provider.id &&
            result.pluginVersion === provider.version &&
            result.sourceSha256 === identity
        )
      if (!existing) grouped.set(provider.id, [...(grouped.get(provider.id) ?? []), capability])
    }
    for (const [providerId, requestedCapabilities] of grouped) {
      const provider = deps.provider(providerId)
      // Grouping above only admitted ids that resolved to a provider.
      if (!provider) throw new Error(`processor provider disappeared: ${providerId}`)
      const config: ProcessorJob['config'] = {}
      const prior = deps.store
        .jobs()
        .find(
          (job) =>
            job.trackId === trackId &&
            job.pluginId === provider.id &&
            job.pluginVersion === provider.version &&
            job.sourceSha256 === identity &&
            job.configHash === processorConfigHash(config) &&
            canonicalJson(job.capabilities) === canonicalJson(requestedCapabilities)
        )
      if (prior) {
        if (manual && ['error', 'cancelled'].includes(prior.status)) {
          await deps.store.saveJob(
            update(prior, { status: 'queued', attempts: 0, progress: 0, error: undefined })
          )
        }
        continue
      }
      const job: ProcessorJob = {
        id: makeId(),
        trackId,
        capabilities: requestedCapabilities,
        pluginId: provider.id,
        pluginVersion: provider.version,
        status: 'queued',
        attempts: 0,
        progress: 0,
        sourceSha256: identity,
        config,
        configHash: processorConfigHash(config),
        createdAt: now(),
        updatedAt: now()
      }
      await deps.store.saveJob(job)
    }
  }

  return {
    async initialize() {
      await deps.store.load()
      for (const job of deps.store.jobs()) {
        if (job.status === 'running') {
          await deps.store.saveJob(
            update(job, {
              status: 'queued',
              error: {
                code: 'interrupted',
                message: 'Iblis closed during analysis',
                retryable: true
              }
            })
          )
        }
      }
      initialized = true
      void pump()
    },
    async enqueue(trackId, capabilities) {
      if (!initialized) await this.initialize()
      await createJobs(trackId, capabilities)
      void pump()
    },
    async retry(trackId, capability) {
      if (!initialized) await this.initialize()
      await createJobs(trackId, [capability], true)
      void pump()
    },
    async cancelTrack(trackId) {
      for (const job of deps.store.jobs()) {
        if (job.trackId !== trackId || !['queued', 'running'].includes(job.status)) continue
        cancelled.add(job.id)
        if (job.status === 'running')
          await deps.client(job.pluginId).cancel(job.id).catch(ignoreFailure)
        await deps.store.saveJob(update(job, { status: 'cancelled' }))
      }
      if (active?.trackId === trackId) await sleep(0)
    },
    async acquirePluginMutation(id) {
      mutations.add(id)
      if (active?.pluginId === id) await deps.client(id).cancel(active.id).catch(ignoreFailure)
      let released = false
      return async () => {
        if (released) return
        released = true
        mutations.delete(id)
        void pump()
      }
    },
    results: (trackId) => deps.store.results(trackId),
    allResults: () => deps.store.allResults(),
    jobs: (trackId) => deps.store.jobs().filter((job) => job.trackId === trackId),
    benchmarks: () =>
      deps.store
        .benchmarks()
        .map((benchmark) => processorBenchmarkView(deps.store, benchmark))
        .sort((a, b) => b.createdAt - a.createdAt),
    async benchmark(trackId, providerIds) {
      if (!initialized) await this.initialize()
      const benchmark = await createProcessorBenchmark(
        { store: deps.store, provider: deps.provider, input: deps.input, hash, now, makeId },
        trackId,
        providerIds
      )
      void pump()
      return benchmark
    },
    settings: () => ({ ...deps.store.settings(), providers: [] }),
    async setDefault(capability, pluginId) {
      if (pluginId) {
        const selected = deps.provider(pluginId)
        assertProcessorDefault(
          selected,
          capability,
          selected ? deps.store.settings().acknowledgements[selected.id] : undefined
        )
      }
      const settings = await deps.store.setDefault(capability, pluginId)
      void pump()
      return settings
    },
    async acknowledge(id) {
      const selected = deps.provider(id)
      if (!selected) throw new Error('processor is unavailable')
      return deps.store.acknowledge(selected.id, providerAcknowledgement(selected, Date.now()))
    }
  }
}
