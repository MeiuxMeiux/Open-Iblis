// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Engine provider registry and router. Shared host code resolves one object
// here and speaks only the EngineProvider surface (./provider.ts) plus the
// registry extras (target snapshots, the picker). Routing is by protocol
// facts from the signed manifest — v1 engines go to the ACE compatibility
// driver, contract-v2 engines each get a generic v2 driver instance — so
// adding an engine never grows an engine-id conditional in shared code.

import type { GenerateRequest, GenerateResponse, PluginManifest } from '@iblis/plugin-sdk'
import {
  err,
  type EngineInfo,
  type InstalledEngineSummary,
  type IpcResult
} from '../../../shared/contract'
import type { QueueComparisonVariant, QueueTarget } from '../../../shared/generation-queue'
import { listInstalled } from '../plugins/registry'
import { readInstalledManifest } from '../plugins/installed-manifest'
import { healthAll } from '../sidecar/supervisor'
import { createAceCompatProvider } from './drivers/ace-compat/driver'
import { createEngineV2Provider } from './drivers/v2/driver'
import { readSignedDescriptor } from './drivers/v2/descriptor'
import { v2CanonicalRequestError } from './drivers/v2/request'
import { defaultEngineFor, setDefaultEngine } from './defaults'
import type { EngineProvider } from './provider'

export type { EngineGenerationEvidence } from './drivers/ace-compat/evidence'

// The operation Create's current surface admits against. Richer operations
// arrive with the capability UI (roadmap 4D) and store their own defaults.
const CREATE_OPERATION = 'music.generate'

export interface EngineRegistry extends EngineProvider {
  startGenerate(
    request: GenerateRequest,
    blueprint?: string,
    target?: QueueTarget
  ): IpcResult<GenerateResponse>
  currentTarget(): QueueTarget | null
  listEngineSummaries(): InstalledEngineSummary[]
  selectEngine(pluginId: string): void
}

interface EngineEntry {
  id: string
  version: string
  manifest: PluginManifest
  protocol: 1 | 2
}

function installedEngines(): EngineEntry[] {
  const entries: EngineEntry[] = []
  for (const plugin of listInstalled()) {
    if (!plugin.activeVersion) continue
    const manifest = readInstalledManifest(plugin.id, plugin.activeVersion)
    if (manifest?.kind !== 'engine') continue
    entries.push({
      id: plugin.id,
      version: plugin.activeVersion,
      manifest,
      protocol: manifest.engine?.protocolVersion === 2 ? 2 : 1
    })
  }
  return entries
}

// Card facts about what an engine can take, from signed data only. A v1
// engine's Create surface is fixed by the compatibility driver; a v2 engine
// declares it in the signed descriptor.
function createSurface(
  engine: EngineEntry
): Pick<InstalledEngineSummary, 'models' | 'operations' | 'styles' | 'lyrics' | 'duration'> {
  if (engine.protocol === 1) {
    return {
      models: [],
      operations: [CREATE_OPERATION],
      styles: true,
      lyrics: true,
      duration: { minSec: 4, maxSec: 240 }
    }
  }
  try {
    const { descriptor } = readSignedDescriptor(engine.id, engine.version, engine.manifest)
    const operation = descriptor.operations.find((candidate) => candidate.id === CREATE_OPERATION)
    return {
      models: descriptor.models.map((model) => `${model.id}@${model.revision}`),
      operations: descriptor.operations.map((candidate) => candidate.id),
      styles: !!operation?.adapters,
      lyrics: !!operation?.lyrics,
      duration: operation?.duration ?? null
    }
  } catch {
    return { models: [], operations: [], styles: false, lyrics: false, duration: null }
  }
}

function createRegistry(): EngineRegistry {
  const ace = createAceCompatProvider()
  const v2 = new Map<string, EngineProvider>()
  const jobDrivers = new Map<string, EngineProvider>()
  let activeJob: { jobId: string; pluginId: string } | null = null

  function driverFor(entry: EngineEntry): EngineProvider {
    if (entry.protocol === 1) return ace
    let driver = v2.get(entry.id)
    if (!driver) {
      driver = createEngineV2Provider(entry.id)
      v2.set(entry.id, driver)
    }
    return driver
  }

  function selectedEngine(): EngineEntry | null {
    const engines = installedEngines()
    if (engines.length === 0) return null
    const preferred = defaultEngineFor(CREATE_OPERATION)
    return engines.find((engine) => engine.id === preferred) ?? engines[0] ?? null
  }

  function selectedDriver(): EngineProvider {
    const engine = selectedEngine()
    return engine ? driverFor(engine) : ace
  }

  function targetOf(engine: EngineEntry): QueueTarget {
    if (engine.protocol === 2) {
      const signed = readSignedDescriptor(engine.id, engine.version, engine.manifest)
      return {
        pluginId: engine.id,
        version: engine.version,
        protocol: 2,
        descriptorHash: signed.hash
      }
    }
    return { pluginId: engine.id, version: engine.version, protocol: 1 }
  }

  // Execution runs the admitted target exactly or explains why it cannot.
  function targetError(target: QueueTarget): { error: string } | { entry: EngineEntry } {
    const engine = installedEngines().find((candidate) => candidate.id === target.pluginId)
    if (!engine) {
      return {
        error: `the engine this take was queued for (${target.pluginId}) is no longer installed — remove the take and queue it again`
      }
    }
    if (engine.version !== target.version || engine.protocol !== target.protocol) {
      return {
        error: `the engine changed after this take was queued (${target.pluginId} ${target.version} is now ${engine.version}) — remove the take and queue it again`
      }
    }
    if (target.protocol === 2) {
      const signed = readSignedDescriptor(engine.id, engine.version, engine.manifest)
      if (target.descriptorHash !== signed.hash) {
        return {
          error: `the engine's signed capabilities changed after this take was queued — remove the take and queue it again`
        }
      }
    }
    return { entry: engine }
  }

  function driverOfJob(jobId: string): EngineProvider {
    const known = jobDrivers.get(jobId)
    if (known) return known
    for (const driver of [ace, ...v2.values()]) {
      if (driver.jobState(jobId).ok) return driver
    }
    return ace
  }

  return {
    id: 'engine-registry',
    engineInfo: (): Promise<EngineInfo> => selectedDriver().engineInfo(),
    activeEngineId: () => activeJob?.pluginId ?? selectedEngine()?.id ?? null,

    // Admission-side rules follow the engine new work will target.
    requestError: (value) => selectedDriver().requestError(value),
    resolveQueuedRequest: (request) => selectedDriver().resolveQueuedRequest(request),
    resolveComparisonPair: (request: GenerateRequest, variant: QueueComparisonVariant) =>
      selectedDriver().resolveComparisonPair(request, variant),

    // Store-side rules must accept every dialect a persisted document may
    // carry, installed or not: a rehydrated queue predating an engine switch
    // is still a valid document. Execution re-verifies the exact target.
    canonicalRequestError: (value) => {
      const aceVerdict = ace.canonicalRequestError(value)
      return aceVerdict === null
        ? null
        : v2CanonicalRequestError(value) === null
          ? null
          : aceVerdict
    },
    validBlueprint: (text) => ace.validBlueprint(text),
    isComparisonControl: (request) => ace.isComparisonControl(request),
    comparisonRecipeError: (control, candidate) => ace.comparisonRecipeError(control, candidate),

    startGenerate(
      request: GenerateRequest,
      blueprint?: string,
      target?: QueueTarget
    ): IpcResult<GenerateResponse> {
      let entry: EngineEntry | null
      if (target) {
        const verdict = targetError(target)
        if ('error' in verdict) return err(verdict.error)
        entry = verdict.entry
      } else {
        entry = selectedEngine()
        if (!entry) return err('no engine installed — install an engine pack first')
      }
      const driver = driverFor(entry)
      const result = driver.startGenerate(request, blueprint)
      if (result.ok) {
        const jobId = result.data.jobId
        jobDrivers.set(jobId, driver)
        activeJob = { jobId, pluginId: entry.id }
        void driver.settled(jobId).finally(() => {
          if (activeJob?.jobId === jobId) activeJob = null
          jobDrivers.delete(jobId)
        })
      }
      return result
    },

    jobState: (jobId) => driverOfJob(jobId).jobState(jobId),
    settled: (jobId) => driverOfJob(jobId).settled(jobId),
    cancelDirect: (jobId) => driverOfJob(jobId).cancelDirect(jobId),
    blueprint: (jobId) => driverOfJob(jobId).blueprint(jobId),
    async abortActive(code: string, message: string): Promise<string | null> {
      for (const driver of [ace, ...v2.values()]) {
        const aborted = await driver.abortActive(code, message)
        if (aborted !== null) return aborted
      }
      return null
    },

    currentTarget(): QueueTarget | null {
      const engine = selectedEngine()
      return engine ? targetOf(engine) : null
    },

    listEngineSummaries(): InstalledEngineSummary[] {
      const selected = selectedEngine()
      const health = healthAll()
      return installedEngines().map((engine) => {
        const running = health[engine.id]?.running ?? false
        const busy = activeJob?.pluginId === engine.id
        return {
          id: engine.id,
          name: engine.manifest.name,
          version: engine.version,
          protocol: engine.protocol,
          running,
          selected: engine.id === selected?.id,
          publisher: engine.manifest.author.name,
          license: engine.manifest.license,
          execution: 'local-sidecar',
          startsOnDemand: engine.protocol === 2,
          readiness: busy
            ? 'busy'
            : running
              ? 'running'
              : engine.protocol === 2
                ? 'ready'
                : 'stopped',
          installBytes: engine.manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0),
          ...createSurface(engine)
        }
      })
    },

    selectEngine(pluginId: string): void {
      const engine = installedEngines().find((candidate) => candidate.id === pluginId)
      if (!engine) throw new Error(`${pluginId} is not an installed engine`)
      setDefaultEngine(CREATE_OPERATION, pluginId)
    }
  }
}

let active: EngineRegistry | null = null

export function engineProvider(): EngineRegistry {
  active ??= createRegistry()
  return active
}
