// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The generic engine-contract-v2 driver: one instance serves one installed
// v2 engine plugin. It binds the pure job client (./jobs) to the sidecar
// supervisor, the signed/live descriptor rules (./descriptor), the request
// translation (./request), and the Library — and exposes it all through the
// engine-neutral EngineProvider interface. It knows no model names: every
// fact comes from the pack's own signed descriptor.

import { app } from 'electron'
import { join } from 'node:path'
import type {
  EngineDescriptorV2,
  GenerateRequest,
  GenerateResponse,
  JobState,
  PluginManifest
} from '@iblis/plugin-sdk'
import {
  ok,
  err,
  type EngineInfo,
  type EngineProfile,
  type IpcResult
} from '../../../../../shared/contract'
import { status } from '../../../plugins/registry'
import { readInstalledManifest } from '../../../plugins/installed-manifest'
import { engineLaunchManifest } from '../../../plugins/launch-manifest'
import { healthAll, requestSidecar, start, stop } from '../../../sidecar/supervisor'
import {
  addGeneratedTrack,
  recordPromptUse,
  saveTrackGeneration,
  saveTrackSiblingOutput
} from '../../../library'
import { log } from '../../../logger'
import type { EngineProvider } from '../../provider'
import { fetchLiveDescriptor, readSignedDescriptor } from './descriptor'
import {
  createEngineV2Client,
  type KeptOutputs,
  type V2JobContext,
  type V2PhaseWindow
} from './jobs'
import { v2Capabilities } from './capabilities'
import {
  buildRecipe,
  operationOf,
  resolveV2Request,
  v2CanonicalRequestError,
  v2RequestError
} from './request'
import { ignoreFailure } from '../../../ignore-failure'
import { errorMessage } from '../../../error-message'

const LIVE_CACHE_MS = 30_000

interface InstalledEngine {
  id: string
  version: string
  manifest: PluginManifest
}

export function createEngineV2Provider(pluginId: string): EngineProvider {
  const providerId = `engine-v2:${pluginId}`
  let liveCache:
    { key: string; expiresAt: number; promise: Promise<EngineDescriptorV2> } | undefined
  let idleTimer: NodeJS.Timeout | undefined

  function installed(): InstalledEngine {
    const active = status(pluginId).activeVersion
    const manifest = active ? readInstalledManifest(pluginId, active) : null
    if (!active || !manifest || manifest.engine?.protocolVersion !== 2) {
      throw new Error('this engine is no longer installed — pick another engine')
    }
    return { id: pluginId, version: active, manifest }
  }

  async function ensureRunning(engine: InstalledEngine): Promise<void> {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = undefined
    }
    if (healthAll()[engine.id]?.running) return
    await start(await engineLaunchManifest(engine.manifest))
  }

  function liveDescriptor(engine: InstalledEngine) {
    const signed = readSignedDescriptor(engine.id, engine.version, engine.manifest)
    const health = healthAll()[engine.id]
    const key = `${engine.id}@${engine.version}:${health?.port ?? 'down'}`
    const now = Date.now()
    if (liveCache?.key === key && liveCache.expiresAt > now) return liveCache.promise
    const promise = fetchLiveDescriptor(
      (path, init) => requestSidecar(engine.id, path, init),
      signed.descriptor
    )
    liveCache = { key, expiresAt: now + LIVE_CACHE_MS, promise }
    void promise.catch(() => {
      if (liveCache?.promise === promise) liveCache = undefined
    })
    return promise
  }

  // On-demand lifecycle: bring the sidecar up, take live facts, build the
  // exact wire recipe. Runs inside the job chain, so a failure lands as the
  // job's error instead of an unhandled rejection.
  async function prepare(request: GenerateRequest): Promise<V2JobContext> {
    const engine = installed()
    const signed = readSignedDescriptor(engine.id, engine.version, engine.manifest)
    await ensureRunning(engine)
    const descriptor = await liveDescriptor(engine)
    const recipe = buildRecipe(request, {
      providerId,
      pluginVersion: engine.version,
      descriptorHash: signed.hash,
      descriptor
    })
    return { engine: { id: engine.id, version: engine.version }, recipe, descriptor }
  }

  function armIdleUnload(engineId: string): void {
    const minutes = (() => {
      try {
        return installed().manifest.executable?.idleUnloadMinutes
      } catch {
        return undefined
      }
    })()
    if (!minutes || minutes <= 0) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      if (client.hasLiveJobs()) return
      void stop(engineId).catch((error: unknown) =>
        log('warn', 'idle engine unload failed', { id: engineId, error: String(error) })
      )
    }, minutes * 60_000)
    idleTimer.unref()
  }

  async function writeEvidence(
    trackId: string,
    jobId: string,
    context: V2JobContext,
    phases: V2PhaseWindow[],
    kept: KeptOutputs
  ): Promise<void> {
    // The generation record's phase vocabulary is closed, so v2 phases map
    // onto it positionally; the exact v2 identity (operation, provider,
    // descriptor hash, profile) rides in the resolved recipe as flat facts.
    const names = ['lm', 'synth', 'finishing'] as const
    const mapped = names.flatMap((phase, index) => {
      const window = phases[index]
      if (!window) return []
      return [
        {
          phase,
          startedAt: window.startedAt,
          finishedAt: Math.max(window.startedAt, window.finishedAt),
          durationMs: Math.max(0, window.finishedAt - window.startedAt)
        }
      ]
    })
    const finishedAt = phases[phases.length - 1]?.finishedAt ?? Date.now()
    const recipe = context.recipe
    const profile = context.descriptor.profiles.find((entry) => entry.id === recipe.profileId)
    const model = context.descriptor.models.find((entry) => entry.id === profile?.modelId)
    const identity: Record<string, string | number> = {
      operation: recipe.operation,
      provider_id: recipe.providerId,
      plugin_version: recipe.pluginVersion,
      descriptor_hash: recipe.descriptorHash,
      engine_family: context.descriptor.engineFamily,
      profile_id: recipe.profileId,
      ...(model ? { model_id: model.id, model_revision: model.revision } : {}),
      ...(recipe.advanced ? { advanced: JSON.stringify(recipe.advanced) } : {}),
      ...(kept.preview ? { preview_output: kept.preview } : {}),
      ...(recipe.targetDurationSec !== undefined
        ? { target_duration_sec: recipe.targetDurationSec }
        : {}),
      ...(recipe.seed !== undefined ? { seed: recipe.seed } : {}),
      ...(recipe.common?.bpm !== undefined ? { bpm: recipe.common.bpm } : {})
    }
    await saveTrackGeneration(trackId, {
      jobId,
      request: {
        prompt: recipe.prompt ?? '',
        durationSec: recipe.targetDurationSec ?? 0,
        preset: recipe.profileId,
        ...(recipe.seed !== undefined ? { seed: recipe.seed } : {})
      },
      startedAt: phases[0]?.startedAt ?? finishedAt,
      finishedAt,
      phases: mapped,
      trace: [],
      resolvedSynthText: JSON.stringify([identity]),
      effectiveRequest: identity,
      engine: { id: context.engine.id, version: context.engine.version }
    })
  }

  const client = createEngineV2Client({
    fetch: (engineId, path, init) => requestSidecar(engineId, path, init),
    prepare,
    stagingRoot: () => join(app.getPath('userData'), 'engine-staging'),
    writeWav: async (jobId, bytes, req, metadata, engine) => {
      const track = await addGeneratedTrack(bytes, req, metadata, engine, jobId)
      return { trackId: track.id }
    },
    writeExtra: (trackId, role, bytes) => saveTrackSiblingOutput(trackId, role, bytes),
    writeEvidence,
    onIdle: armIdleUnload
  })

  async function engineInfo(): Promise<EngineInfo> {
    let engine: InstalledEngine
    try {
      engine = installed()
    } catch {
      return { id: null, running: false, profiles: [] }
    }
    const running = healthAll()[engine.id]?.running ?? false
    try {
      const signed = readSignedDescriptor(engine.id, engine.version, engine.manifest)
      const descriptor = running ? await liveDescriptor(engine) : signed.descriptor
      return {
        id: engine.id,
        running,
        startsOnDemand: true,
        profiles: profilesFrom(descriptor),
        capabilities: v2Capabilities(descriptor),
        runtime: {
          version: engine.version,
          lmModels: [],
          synthModels: descriptor.models.map((model) => `${model.id}@${model.revision}`),
          adapters: [],
          solvers: [],
          defaultLmModel: '',
          defaultSynthModel: descriptor.models[0]
            ? `${descriptor.models[0].id}@${descriptor.models[0].revision}`
            : '',
          defaultTemperature: 0
        }
      }
    } catch (error) {
      return {
        id: engine.id,
        running,
        startsOnDemand: true,
        profiles: [],
        runtimeError: errorMessage(error)
      }
    }
  }

  // The v1 EngineProfile shape carries ACE-era tuning bounds; a v2 profile is
  // a fixed recipe, so every bound collapses to its single declared point.
  function profilesFrom(descriptor: EngineDescriptorV2): EngineProfile[] {
    const operation = operationOf(descriptor)
    return descriptor.profiles
      .filter((profile) => operation.profileIds.includes(profile.id))
      .map((profile) => {
        const model = descriptor.models.find((candidate) => candidate.id === profile.modelId)
        return {
          id: profile.id,
          name: profile.label,
          kind: 'validated' as const,
          synthModel: model ? `${model.id}@${model.revision}` : profile.modelId,
          steps: { default: 1, min: 1, max: 1 },
          guidance: { default: 1, min: 1, max: 1 },
          shift: 0,
          solver: 'euler' as const,
          fixedRecipe: true as const
        }
      })
  }

  async function resolveQueuedRequest(request: GenerateRequest): Promise<GenerateRequest> {
    const engine = installed()
    const signed = readSignedDescriptor(engine.id, engine.version, engine.manifest)
    return resolveV2Request(request, signed.descriptor)
  }

  return {
    id: providerId,
    engineInfo,
    activeEngineId: () => {
      try {
        return installed().id
      } catch {
        return null
      }
    },
    requestError: v2RequestError,
    canonicalRequestError: v2CanonicalRequestError,
    // Blind comparisons are a per-driver capability; no v2 engine offers one
    // yet, so the store refuses v2 comparison documents outright.
    validBlueprint: () => false,
    isComparisonControl: () => false,
    comparisonRecipeError: () => 'this engine does not support blind comparisons',
    resolveQueuedRequest,
    resolveComparisonPair: () =>
      Promise.reject(new Error('this engine does not support blind comparisons')),
    startGenerate(req: GenerateRequest, blueprint?: string): IpcResult<GenerateResponse> {
      try {
        if (blueprint !== undefined) return err('this engine does not support blind comparisons')
        const invalid = v2CanonicalRequestError(req)
        if (invalid) return err(invalid)
        installed() // fail fast when the pack is gone; not-running is fine (on-demand)
        void recordPromptUse(req.prompt).catch(ignoreFailure)
        return ok(client.generate(req))
      } catch (e) {
        return err(errorMessage(e))
      }
    },
    jobState(jobId: string): IpcResult<JobState> {
      const state = client.jobState(jobId)
      return state ? ok(state) : err(`unknown job ${jobId}`)
    },
    settled: (jobId) => client.settled(jobId),
    async cancelDirect(jobId: string): Promise<void> {
      await client.cancel(jobId)
    },
    abortActive: (code, message) => client.abortActive(code, message),
    blueprint: () => undefined
  }
}
