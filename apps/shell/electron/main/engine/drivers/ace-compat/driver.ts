// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The ACE-Step compatibility driver: the one place the shell still speaks the
// pinned ace-server dialect. It binds the pure state machine (./client) to the
// real sidecar transport (requestSidecar), an on-disk WAV writer, and resolves
// which installed plugin is the active engine — then exposes all of it through
// the engine-neutral EngineProvider interface (../../provider.ts). Shared host
// code never imports this module directly; it goes through engineProvider().

import type { GenerateRequest, GenerateResponse, JobState } from '@iblis/plugin-sdk'
import {
  ok,
  err,
  type EngineCapabilities,
  type EngineInfo,
  type IpcResult
} from '../../../../../shared/contract'
import type { QueueComparisonVariant } from '../../../../../shared/generation-queue'
import { listInstalled } from '../../../plugins/registry'
import { readInstalledManifest } from '../../../plugins/installed-manifest'
import { healthAll, requestSidecar } from '../../../sidecar/supervisor'
import { addGeneratedTrack, recordPromptUse, saveTrackGeneration } from '../../../library'
import type { EngineProvider } from '../../../engine/provider'
import { createEngineClient, type EngineClient } from './client'
import type { EngineGenerationEvidence, GenerationEngineIdentity } from './evidence'
import type { WavMetadata } from '../../../media/wav'
import { profilesFromProps, readEngineProps, runtimeFromProps, type EngineProps } from './props'
import { canonicalRequestError, generationRequestError, resolveGenerationRequest } from './request'
import { validComparisonBlueprint } from './protocol'
import { comparisonRecipeError, isComparisonControl } from './comparison'
import { ignoreFailure } from '../../../ignore-failure'
import { errorMessage } from '../../../error-message'

// The first installed plugin whose ACTIVE version is a v1 kind:"engine".
// Renderer-only and skin plugins are skipped, and so is any manifest with a
// v2 engine section — those route to the contract-v2 driver, never here.
// The compatibility driver's Create surface is fixed by the ACE protocol:
// structured lyrics (or the LM writing its own), adapters as Styles, native
// tuning knobs, and the 4 through 240 second window Create has always used.
const ACE_CAPABILITIES: EngineCapabilities = {
  protocol: 1,
  operation: 'music.generate',
  lyrics: 'ace-structured',
  autoLyrics: true,
  styles: true,
  seed: true,
  commonControls: ['negativePrompt', 'bpm', 'keyscale', 'timeSignature'],
  advancedControls: [],
  duration: { minSec: 4, maxSec: 240 },
  nativeTuning: true,
  outputs: ['mix']
}

function activeEngine(): { id: string; version: string } | null {
  for (const plugin of listInstalled()) {
    if (!plugin.activeVersion) continue
    const manifest = readInstalledManifest(plugin.id, plugin.activeVersion)
    if (manifest?.kind === 'engine' && !manifest.engine) {
      return { id: plugin.id, version: plugin.activeVersion }
    }
  }
  return null
}

const PROPS_CACHE_MS = 30_000
const PROPS_TIMEOUT_MS = 5000

export function createAceCompatProvider(): EngineProvider {
  let propsCache: { key: string; expiresAt: number; promise: Promise<EngineProps> } | undefined
  let client: EngineClient | null = null

  function liveProps(engine: { id: string; version: string }): Promise<EngineProps> {
    const health = healthAll()[engine.id]
    if (!health?.running) throw new Error('the engine is not running')
    const key = `${engine.id}@${engine.version}:${health.port ?? 'unknown'}`
    const now = Date.now()
    if (propsCache?.key === key && propsCache.expiresAt > now) return propsCache.promise
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROPS_TIMEOUT_MS)
    const promise = requestSidecar(engine.id, '/props', { signal: controller.signal })
      .then(readEngineProps)
      .catch((error: unknown) => {
        if (controller.signal.aborted) throw new Error('engine /props timed out')
        throw error
      })
      .finally(() => clearTimeout(timer))
    propsCache = { key, expiresAt: now + PROPS_CACHE_MS, promise }
    void promise.catch(() => {
      if (propsCache?.promise === promise) propsCache = undefined
    })
    return promise
  }

  // A finished generation becomes a library track (tracks/<ulid>/audio.wav +
  // a row carrying prompt/seed/preset), not a loose <jobId>.wav.
  async function writeWav(
    jobId: string,
    bytes: Buffer,
    req: GenerateRequest,
    metadata: WavMetadata,
    engineIdentity: GenerationEngineIdentity
  ): Promise<{ trackId: string }> {
    const track = await addGeneratedTrack(bytes, req, metadata, engineIdentity, jobId)
    return { trackId: track.id }
  }

  async function writeEvidence(trackId: string, evidence: EngineGenerationEvidence): Promise<void> {
    await saveTrackGeneration(trackId, evidence)
  }

  function engine(): EngineClient {
    client ??= createEngineClient({
      // Resolve the engine id per request so a freshly (re)started sidecar is
      // picked up. Throws if no engine is installed/running — caught by the
      // client and surfaced as the job's error field.
      fetch: (path, init) => {
        const eng = activeEngine()
        if (!eng) throw new Error('no engine plugin installed')
        return requestSidecar(eng.id, path, init)
      },
      writeWav,
      writeEvidence
    })
    return client
  }

  // Runtime facts replace manifest marketing presets. A malformed, oversized,
  // or unavailable /props response is visible as runtimeError and exposes no
  // profiles, so the renderer cannot queue an invented recipe.
  async function engineInfo(): Promise<EngineInfo> {
    const engine = activeEngine()
    if (!engine) return { id: null, running: false, profiles: [] }
    const running = healthAll()[engine.id]?.running ?? false
    if (!running) return { id: engine.id, running: false, profiles: [] }
    try {
      const props = await liveProps(engine)
      const profiles = profilesFromProps(props)
      const runtime = runtimeFromProps(props)
      if (profiles.length === 0) {
        return {
          id: engine.id,
          running: true,
          profiles: [],
          runtime,
          runtimeError: 'engine /props has no validated installed turbo profile'
        }
      }
      return { id: engine.id, running: true, profiles, runtime, capabilities: ACE_CAPABILITIES }
    } catch (error) {
      return {
        id: engine.id,
        running: true,
        profiles: [],
        runtimeError: errorMessage(error)
      }
    }
  }

  // Queue admission calls this once before persistence. It is the only place
  // omitted runtime defaults and random seeds become concrete.
  async function resolveQueuedRequest(request: GenerateRequest): Promise<GenerateRequest> {
    const engine = activeEngine()
    if (!engine) throw new Error('no engine installed — install the engine pack first')
    return resolveGenerationRequest(request, await liveProps(engine))
  }

  // The blind A/B pair: the control is always the exact validated Turbo tuple,
  // the candidate varies only within the requested profile, and both must
  // share one LM blueprint.
  async function resolveComparisonPair(
    request: GenerateRequest,
    variant: QueueComparisonVariant
  ): Promise<{ control: GenerateRequest; candidate: GenerateRequest }> {
    const control = await resolveQueuedRequest({
      ...request,
      preset: 'turbo-validated',
      config: {
        ...request.config,
        steps: 8,
        guidance: 1,
        shift: 3,
        solver: 'euler',
        synthModel: undefined
      }
    })
    const candidate = await resolveQueuedRequest({
      ...control,
      preset: variant.profileId,
      config: {
        ...control.config,
        steps: variant.steps,
        guidance: variant.guidance,
        shift: undefined,
        solver: undefined,
        synthModel: undefined
      }
    })
    const invalid = comparisonRecipeError(control, candidate)
    if (invalid) throw new Error(invalid)
    return { control, candidate }
  }

  // Start a generation. Fails fast (before creating a job) if no engine is
  // installed or its sidecar is not live, so the UI gets a clear message
  // instead of a phantom job that immediately errors.
  function startGenerate(req: GenerateRequest, blueprint?: string): IpcResult<GenerateResponse> {
    try {
      const invalid = canonicalRequestError(req)
      if (invalid) return err(invalid)
      const active = activeEngine()
      if (!active) return err('no engine installed — install the engine pack first')
      if (!(healthAll()[active.id]?.running ?? false)) return err('the engine is not running')
      // History remembers the prompt as soon as the job starts; a failed or
      // cancelled take is still worth recalling. Never blocks the generation.
      void recordPromptUse(req.prompt).catch(ignoreFailure)
      return ok(engine().generate(req, { id: active.id, version: active.version }, blueprint))
    } catch (e) {
      return err(errorMessage(e))
    }
  }

  return {
    id: 'ace-step-v1-compat',
    engineInfo,
    activeEngineId: () => activeEngine()?.id ?? null,
    requestError: generationRequestError,
    canonicalRequestError,
    validBlueprint: validComparisonBlueprint,
    isComparisonControl,
    comparisonRecipeError,
    resolveQueuedRequest,
    resolveComparisonPair,
    startGenerate,
    jobState(jobId: string): IpcResult<JobState> {
      const state = engine().jobState(jobId)
      return state ? ok(state) : err(`unknown job ${jobId}`)
    },
    settled: (jobId) => engine().settled(jobId),
    async cancelDirect(jobId: string): Promise<void> {
      await engine().cancel(jobId)
    },
    abortActive: (code, message) => engine().abortActive(code, message),
    blueprint: (jobId) => engine().blueprint(jobId)
  }
}
