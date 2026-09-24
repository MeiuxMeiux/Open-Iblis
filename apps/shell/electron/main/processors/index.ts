// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow, dialog } from 'electron'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
import type { ProcessorInput, ProcessorProvider, ProcessorScheduler } from './scheduler'
import { createProcessorScheduler } from './scheduler'
import { createProcessorSidecarClient } from './client'
import { createProcessorStore } from './store'
import { BUILTIN_PROCESSORS, builtinProcessor, isBuiltinProcessor } from './builtin/catalog'
import { createBuiltinProcessorClient } from './builtin/client'
import { readInstalledManifest } from '../plugins/installed-manifest'
import { listInstalled } from '../plugins/registry'
import { requestSidecar } from '../sidecar/supervisor'
import { loadLabCatalog } from '../catalog/lab-client'
import { currentLeaseForFeature } from '../licensing'
import type {
  ProcessorAcknowledgement,
  ProcessorBenchmarkView,
  ProcessorProviderDetail,
  ProcessorResultRecord,
  ProcessorSettings
} from '../../../shared/processors'
import type { ProcessorJobView, ProcessorProviderView } from '../../../shared/processors'
import { detectedTrackFacts, type DetectedTrackFacts } from '../../../shared/processors'

let scheduler: ProcessorScheduler | null = null

function provider(id: string): ProcessorProvider | null {
  const builtin = builtinProcessor(id)
  if (builtin) {
    return {
      id: builtin.id,
      name: builtin.name,
      version: builtin.version,
      capabilities: builtin.capabilities,
      legalStatus: builtin.evaluation.status,
      evaluation: builtin.evaluation
    }
  }
  const installed = listInstalled().find((candidate) => candidate.id === id)
  if (!installed?.activeVersion) return null
  const manifest = readInstalledManifest(id, installed.activeVersion)
  if (manifest?.kind !== 'processor' || !manifest.executable) return null
  const capabilities = manifest.capabilities.filter(
    (capability): capability is ProcessorAnalysisCapability =>
      capability === 'bpm-detect' || capability === 'key-detect'
  )
  return capabilities.length
    ? {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        capabilities,
        legalStatus: manifest.evaluation?.status ?? 'unreviewed',
        ...(manifest.evaluation ? { evaluation: manifest.evaluation } : {})
      }
    : null
}

function isAcknowledged(
  acknowledgement: ProcessorAcknowledgement | undefined,
  manifest: { version: string; evaluation?: { upstreamRevision: string } }
): boolean {
  return Boolean(
    acknowledgement &&
    manifest.evaluation &&
    acknowledgement.version === manifest.version &&
    acknowledgement.upstreamRevision === manifest.evaluation.upstreamRevision
  )
}

function requiresAcknowledgement(manifest: {
  evaluation?: { status: string; distribution: string }
}): boolean {
  return Boolean(
    manifest.evaluation &&
    (manifest.evaluation.status !== 'commercial-candidate' ||
      manifest.evaluation.distribution !== 'public-catalog')
  )
}

function builtinViews(
  acknowledgements: ProcessorSettings['acknowledgements']
): ProcessorProviderView[] {
  return BUILTIN_PROCESSORS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    version: definition.version,
    capabilities: definition.capabilities,
    runtime: 'built-in',
    legalStatus: definition.evaluation.status,
    requiresAcknowledgement: requiresAcknowledgement(definition),
    acknowledged: isAcknowledged(acknowledgements[definition.id], definition)
  }))
}

function providers(
  acknowledgements: ProcessorSettings['acknowledgements']
): ProcessorProviderView[] {
  return installedViews(acknowledgements).concat(builtinViews(acknowledgements))
}

function installedViews(
  acknowledgements: ProcessorSettings['acknowledgements']
): ProcessorProviderView[] {
  return listInstalled().flatMap((installed) => {
    if (!installed.activeVersion) return []
    const manifest = readInstalledManifest(installed.id, installed.activeVersion)
    if (manifest?.kind !== 'processor' || !manifest.executable) return []
    const capabilities = manifest.capabilities.filter(
      (capability): capability is ProcessorAnalysisCapability =>
        capability === 'bpm-detect' || capability === 'key-detect'
    )
    return capabilities.length
      ? [
          {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            capabilities,
            runtime: 'native-sidecar',
            legalStatus: manifest.evaluation?.status ?? 'unreviewed',
            requiresAcknowledgement: requiresAcknowledgement(manifest),
            acknowledged: isAcknowledged(acknowledgements[manifest.id], manifest)
          }
        ]
      : []
  })
}

export function processorProviderDetail(id: string): ProcessorProviderDetail | null {
  const builtin = builtinProcessor(id)
  if (builtin) {
    const settings = scheduler?.settings()
    return {
      id: builtin.id,
      name: builtin.name,
      version: builtin.version,
      capabilities: builtin.capabilities,
      codeLicense: builtin.codeLicense,
      author: builtin.author,
      ...(builtin.authorUrl ? { authorUrl: builtin.authorUrl } : {}),
      evaluation: builtin.evaluation,
      runtime: 'built-in',
      legalStatus: builtin.evaluation.status,
      requiresAcknowledgement: requiresAcknowledgement(builtin),
      acknowledged: isAcknowledged(settings?.acknowledgements[builtin.id], builtin)
    }
  }
  const installed = listInstalled().find((candidate) => candidate.id === id)
  if (!installed?.activeVersion) return null
  const manifest = readInstalledManifest(id, installed.activeVersion)
  if (manifest?.kind !== 'processor') return null
  const capabilities = manifest.capabilities.filter(
    (capability): capability is ProcessorAnalysisCapability =>
      capability === 'bpm-detect' || capability === 'key-detect'
  )
  if (!capabilities.length) return null
  const settings = scheduler?.settings()
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    capabilities,
    codeLicense: manifest.license,
    author: manifest.author.name,
    ...(manifest.author.url ? { authorUrl: manifest.author.url } : {}),
    ...(manifest.evaluation ? { evaluation: manifest.evaluation } : {}),
    runtime: 'native-sidecar',
    legalStatus: manifest.evaluation?.status ?? 'unreviewed',
    requiresAcknowledgement: requiresAcknowledgement(manifest),
    acknowledged: isAcknowledged(settings?.acknowledgements[manifest.id], manifest)
  }
}

// Internal-only seam for the later lab UI/install flow. It deliberately has no
// contextBridge handler: its return value is a full signed manifest and must
// not reveal private asset URLs or the lease to the renderer.
/** @public staged for the processor lab (docs/feature/processor-lab.md) */
export async function loadProcessorLabCatalog() {
  return loadLabCatalog({ lease: currentLeaseForFeature('labs') })
}

// The host is wired from the composition root: `input` reads a library track
// and `mayRun` is the idle gate (no generation, no training). Injecting both
// keeps this module free of imports back into the library and queue.
export interface ProcessorHostDeps {
  input: (trackId: string) => Promise<ProcessorInput | null>
  mayRun: () => Promise<boolean>
}

export async function initializeProcessors({ input, mayRun }: ProcessorHostDeps): Promise<void> {
  if (scheduler) return
  const storeFile = join(app.getPath('userData'), 'processor-jobs.json')
  const firstRun = await stat(storeFile).then(
    () => false,
    () => true
  )
  const store = createProcessorStore(storeFile)
  scheduler = createProcessorScheduler({
    store,
    provider,
    input,
    client: (id) =>
      isBuiltinProcessor(id)
        ? createBuiltinProcessorClient(id)
        : createProcessorSidecarClient((path, init) => requestSidecar(id, path, init)),
    mayRun
  })
  await scheduler.initialize()
  // First initialization of this store only: default both capabilities to the
  // first-party detector so generated audio is always checked out of the box.
  // Users can still turn detection off; an existing store is never reseeded,
  // so a deliberate "Turn off" stays off across restarts.
  if (firstRun) {
    await scheduler.setDefault('bpm-detect', 'mx.iblis.builtin.dsp')
    await scheduler.setDefault('key-detect', 'mx.iblis.builtin.dsp')
  }
}

function host(): ProcessorScheduler {
  if (!scheduler) throw new Error('processor host is not initialized')
  return scheduler
}

export async function scheduleProcessorAnalysis(trackId: string): Promise<void> {
  await host().enqueue(trackId)
}

export async function retryProcessorAnalysis(
  trackId: string,
  capability: ProcessorAnalysisCapability
): Promise<void> {
  await host().retry(trackId, capability)
}

export async function cancelProcessorTrack(trackId: string): Promise<void> {
  await host().cancelTrack(trackId)
}

export async function acquireProcessorMutation(id: string): Promise<() => Promise<void>> {
  return host().acquirePluginMutation(id)
}

export function processorResults(trackId: string): ProcessorResultRecord[] {
  return scheduler?.results(trackId) ?? []
}

// Compact detected facts for every track in one pass — the Library list rides
// this instead of issuing one results lookup per row.
export function detectedFactsByTrack(): Record<string, DetectedTrackFacts> {
  if (!scheduler) return {}
  const defaults = scheduler.settings().defaults
  const byTrack = new Map<string, ProcessorResultRecord[]>()
  for (const result of scheduler.allResults()) {
    const group = byTrack.get(result.trackId) ?? []
    group.push(result)
    byTrack.set(result.trackId, group)
  }
  const facts: Record<string, DetectedTrackFacts> = {}
  for (const [trackId, results] of byTrack) {
    const detected = detectedTrackFacts(results, defaults)
    if (detected) facts[trackId] = detected
  }
  return facts
}

export function detectedFactsForTrack(trackId: string): DetectedTrackFacts | null {
  if (!scheduler) return null
  return detectedTrackFacts(scheduler.results(trackId), scheduler.settings().defaults)
}

export function processorJobs(trackId: string): ProcessorJobView[] {
  return scheduler?.jobs(trackId) ?? []
}

export function processorSettings(): ProcessorSettings {
  const settings = scheduler?.settings() ?? { defaults: {}, providers: [], acknowledgements: {} }
  return { ...settings, providers: providers(settings.acknowledgements) }
}

export async function setProcessorDefault(
  capability: ProcessorAnalysisCapability,
  pluginId?: string
): Promise<ProcessorSettings> {
  const settings = await host().setDefault(capability, pluginId)
  return { ...settings, providers: providers(settings.acknowledgements) }
}

export async function acknowledgeProcessorProvider(id: string): Promise<ProcessorSettings> {
  const settings = await host().acknowledge(id)
  return { ...settings, providers: providers(settings.acknowledgements) }
}

export function processorBenchmarks(): ProcessorBenchmarkView[] {
  return scheduler?.benchmarks() ?? []
}

export async function queueProcessorBenchmark(
  trackId: string,
  providerIds: string[]
): Promise<ProcessorBenchmarkView> {
  return host().benchmark(trackId, providerIds)
}

export async function exportProcessorBenchmark(
  id: string,
  window: BrowserWindow | null
): Promise<boolean> {
  const benchmark = host()
    .benchmarks()
    .find((candidate) => candidate.id === id)
  if (!benchmark) throw new Error('benchmark is unavailable')
  const options = {
    title: 'Export processor benchmark',
    defaultPath: `iblis-processor-benchmark-${id}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return false
  await writeFile(
    result.filePath,
    JSON.stringify({ schemaVersion: 1, exportedAt: Date.now(), benchmark }, null, 2),
    'utf8'
  )
  return true
}
