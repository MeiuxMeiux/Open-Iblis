// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The stem job host: one serial queue, gated on the same idle rule as
// analysis (no generation, no training), with explicit cancel, restart
// recovery, and plugin-mutation leases. Pure over its dependencies so the
// state machine is tested without Electron or a sidecar.

import type { StemRole } from '@iblis/plugin-sdk'
import type { StemJobView, StemSettings } from '../../../shared/stems'
import type { StemSidecarClient } from './client'
import type { StemMeasurement } from './measure'
import type { StemJob, StemStore } from './store'
import { createStaging, discardStaging, promoteStemSet, type StemSetRecordV1 } from './promote'

const POLL_MS = 700
const IDLE_WAIT_MS = 2000

export interface StemProviderInfo {
  id: string
  name: string
  version: string
  model: string
}

export interface StemTrackInput {
  audioPath: string
  trackDir: string
  sampleRateHz: number
  durationSec: number
}

export interface StemHostDeps {
  store: StemStore
  provider(id: string): StemProviderInfo | null
  defaultProvider(settings: StemSettings): StemProviderInfo | null
  client(id: string): StemSidecarClient
  input(trackId: string): Promise<StemTrackInput | null>
  mayRun(): Promise<boolean>
  measure(files: { role: StemRole; path: string }[]): Promise<StemMeasurement[]>
  hash(path: string): Promise<string>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  makeId?: () => string
  onPromoted?: (record: StemSetRecordV1) => void
}

export interface StemHost {
  initialize(): Promise<void>
  split(trackId: string, providerId?: string): Promise<StemJobView>
  cancel(trackId: string): Promise<void>
  job(trackId: string): StemJobView | undefined
  removeTrack(trackId: string): Promise<void>
  acquirePluginMutation(id: string): Promise<() => Promise<void>>
  settings(): StemSettings
  setSettings(patch: Partial<StemSettings>): Promise<StemSettings>
}

const ACTIVE = new Set(['queued', 'running'])

function publicView(job: StemJob): StemJobView {
  const view: StemJobView & Partial<Pick<StemJob, 'providerVersion' | 'sourceSha256'>> = { ...job }
  delete view.providerVersion
  delete view.sourceSha256
  return view
}

export function createStemHost(deps: StemHostDeps): StemHost {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const makeId = deps.makeId ?? (() => crypto.randomUUID().replaceAll('-', ''))
  const live = new Map<string, StemJob>()
  const cancelled = new Set<string>()
  const mutations = new Set<string>()
  let active: StemJob | null = null
  let pumping: Promise<void> | null = null
  // Read through a function so the narrowing of `active` does not stick
  // across awaits in the wait loops below.
  const isActive = (id: string): boolean => active?.id === id
  const activeProvider = (): string | undefined => active?.providerId

  function current(trackId: string): StemJob | undefined {
    return live.get(trackId) ?? deps.store.job(trackId)
  }

  async function save(job: StemJob, patch: Partial<StemJob>, persist = true): Promise<StemJob> {
    const next = { ...job, ...patch, updatedAt: now() }
    live.set(next.trackId, next)
    if (persist) await deps.store.saveJob(next)
    return next
  }

  async function fail(job: StemJob, error: string, trackDir?: string): Promise<void> {
    if (trackDir) await discardStaging(trackDir, job.id).catch(() => undefined)
    await save(job, { status: 'error', error })
  }

  async function waitForIdle(job: StemJob): Promise<boolean> {
    while (!(await deps.mayRun())) {
      if (cancelled.has(job.id)) return false
      await sleep(IDLE_WAIT_MS)
    }
    return !cancelled.has(job.id)
  }

  async function poll(job: StemJob, client: StemSidecarClient) {
    for (;;) {
      if (cancelled.has(job.id) || mutations.has(job.providerId)) {
        await client.cancel(job.id).catch(() => undefined)
        return null
      }
      const state = await client.state(job.id)
      if (state.status === 'done') return state
      if (state.status === 'error') throw new Error(state.error)
      if (state.status === 'cancelled') return null
      job = await save(
        job,
        {
          progress: Math.min(0.95, state.progress),
          ...(state.stage ? { stage: state.stage } : {}),
          ...(state.backend ? { runningOn: state.backend } : {}),
          ...(state.notice ? { notice: state.notice } : {})
        },
        false
      )
      await sleep(POLL_MS)
    }
  }

  async function run(queued: StemJob): Promise<void> {
    let job = queued
    if (!(await waitForIdle(job))) return void (await save(job, { status: 'cancelled' }))
    const provider = deps.provider(job.providerId)
    if (provider?.version !== job.providerVersion || mutations.has(job.providerId)) {
      return fail(
        job,
        'The selected stem separator is no longer installed or was updated. Split again.'
      )
    }
    const input = await deps.input(job.trackId)
    if (!input) return fail(job, 'The track audio is unavailable.')
    if ((await deps.hash(input.audioPath)) !== job.sourceSha256) {
      return fail(job, 'The track audio changed before separation. Split again.')
    }
    const client = deps.client(job.providerId)
    try {
      const stagingDir = await createStaging(input.trackDir, job.id)
      job = await save(job, { status: 'running', progress: 0, stage: 'decoding' })
      await client.start({
        protocolVersion: 2,
        jobId: job.id,
        transform: 'stem-split',
        input: { audioPath: input.audioPath, sourceSha256: job.sourceSha256 },
        stagingDir,
        config: { backend: job.backend }
      })
      const done = await poll(job, client)
      job = live.get(job.trackId) ?? job
      if (!done) {
        await discardStaging(input.trackDir, job.id).catch(() => undefined)
        return void (await save(job, { status: 'cancelled' }))
      }
      job = await save(
        job,
        {
          stage: 'verifying',
          progress: 0.96,
          ...(done.backend ? { runningOn: done.backend } : {})
        },
        false
      )
      if ((await deps.hash(input.audioPath)) !== job.sourceSha256)
        throw new Error('The track audio changed during separation.')
      const record = await promoteStemSet({
        trackDir: input.trackDir,
        trackId: job.trackId,
        jobId: job.id,
        sourceSha256: job.sourceSha256,
        source: { sampleRateHz: input.sampleRateHz, durationSec: input.durationSec },
        outputs: done.outputs,
        metrics: done.metrics,
        provider,
        backend: done.backend ?? job.runningOn ?? 'unknown',
        ...(done.notice ? { notice: done.notice } : {}),
        measure: (files) => deps.measure(files),
        now
      })
      await save(job, { status: 'done', progress: 1, stage: 'done' })
      deps.onPromoted?.(record)
    } catch (error) {
      if (cancelled.has(job.id)) {
        await discardStaging(input.trackDir, job.id).catch(() => undefined)
        return void (await save(job, { status: 'cancelled' }))
      }
      await fail(job, (error as Error | null)?.message ?? 'Stem separation failed.', input.trackDir)
    }
  }

  function pump(): void {
    if (pumping) return
    pumping = (async () => {
      for (;;) {
        const next = [...live.values()]
          .filter((j) => j.status === 'queued')
          .sort((a, b) => a.createdAt - b.createdAt)[0]
        if (!next) break
        active = next
        await run(next).catch(() => undefined)
        active = null
      }
    })().finally(() => {
      pumping = null
    })
  }

  const host: StemHost = {
    async initialize() {
      await deps.store.load()
      for (const job of deps.store.jobs()) {
        if (!ACTIVE.has(job.status)) continue
        const input = await deps.input(job.trackId).catch(() => null)
        if (input) await discardStaging(input.trackDir, job.id).catch(() => undefined)
        await save(job, {
          status: 'error',
          error: 'Interrupted when Iblis closed. Split again to retry.'
        })
      }
    },
    async split(trackId, providerId) {
      const existing = current(trackId)
      if (existing && ACTIVE.has(existing.status)) return publicView(existing)
      const settings = deps.store.settings()
      const provider = providerId ? deps.provider(providerId) : deps.defaultProvider(settings)
      if (!provider) throw new Error('No stem separator is installed. Install one from Plugins.')
      if (mutations.has(provider.id))
        throw new Error('That stem separator is being updated. Try again shortly.')
      const input = await deps.input(trackId)
      if (!input) throw new Error('The track audio is unavailable.')
      const job: StemJob = {
        id: makeId(),
        trackId,
        providerId: provider.id,
        providerName: provider.name,
        providerVersion: provider.version,
        backend: settings.backend,
        sourceSha256: await deps.hash(input.audioPath),
        status: 'queued',
        progress: 0,
        stage: 'queued',
        createdAt: now(),
        updatedAt: now()
      }
      await save(job, {})
      pump()
      return publicView(job)
    },
    async cancel(trackId) {
      const job = current(trackId)
      if (!job || !ACTIVE.has(job.status)) return
      cancelled.add(job.id)
      if (active?.id !== job.id) {
        await save(job, { status: 'cancelled' })
        return
      }
      // The run loop sees the flag on its next poll, asks the sidecar to stop,
      // and records the cancel; wait for that so callers can rely on it.
      while (isActive(job.id)) await sleep(50)
    },
    job(trackId) {
      const job = current(trackId)
      return job ? publicView(job) : undefined
    },
    removeTrack: async (trackId) => {
      await host.cancel(trackId)
      live.delete(trackId)
      await deps.store.removeTrack(trackId)
    },
    async acquirePluginMutation(id) {
      mutations.add(id)
      while (activeProvider() === id) await sleep(50)
      return () => {
        mutations.delete(id)
        return Promise.resolve()
      }
    },
    settings: () => deps.store.settings(),
    setSettings: (patch) => deps.store.setSettings(patch)
  }
  return host
}
