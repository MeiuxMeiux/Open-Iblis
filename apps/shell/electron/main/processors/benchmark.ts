// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  ProcessorBenchmarkProvider,
  ProcessorBenchmarkRun,
  ProcessorBenchmarkView
} from '../../../shared/processors'
import type { ProcessorJob, ProcessorStore } from './store'
import { processorConfigHash } from './config'
import { assertProcessorDefault, type ProcessorSelectionProvider } from './selection'

export type BenchmarkProvider = ProcessorSelectionProvider & {
  name?: string
  legalStatus?: ProcessorBenchmarkProvider['legalStatus']
}

export interface BenchmarkInput {
  id: string
  audioPath: string
  format: string
}

export interface BenchmarkDeps {
  store: ProcessorStore
  provider(id: string): BenchmarkProvider | null
  input(trackId: string): Promise<BenchmarkInput | null>
  hash(path: string): Promise<string>
  now(): number
  makeId(): string
}

export function processorBenchmarkView(
  store: ProcessorStore,
  benchmark: ProcessorBenchmarkRun
): ProcessorBenchmarkView {
  const jobs = store.jobs().filter((job) => job.benchmarkId === benchmark.id)
  const selected = new Set(
    benchmark.providers.map((provider) => `${provider.id}:${provider.version}`)
  )
  const results = store
    .results(benchmark.trackId)
    .filter(
      (result) =>
        result.sourceSha256 === benchmark.sourceSha256 &&
        selected.has(`${result.pluginId}:${result.pluginVersion}`)
    )
    .map((result) => ({ ...result, peakMemoryBytes: null }))
  return { ...benchmark, jobs, results }
}

export async function createProcessorBenchmark(
  deps: BenchmarkDeps,
  trackId: string,
  providerIds: string[]
): Promise<ProcessorBenchmarkView> {
  if (new Set(providerIds).size !== providerIds.length || providerIds.length < 2) {
    throw new Error('choose at least two different installed providers to benchmark')
  }
  const input = await deps.input(trackId)
  if (input?.format.toLowerCase() !== 'wav') {
    throw new Error('choose an available WAV track to benchmark')
  }
  const sourceSha256 = await deps.hash(input.audioPath)
  const settings = deps.store.settings()
  const selected = providerIds.map((id) => {
    const candidate = deps.provider(id)
    if (!candidate) throw new Error(`benchmark processor is unavailable: ${id}`)
    for (const capability of candidate.capabilities) {
      assertProcessorDefault(candidate, capability, settings.acknowledgements[candidate.id])
    }
    return candidate
  })
  const createdAt = deps.now()
  const benchmark: ProcessorBenchmarkRun = {
    id: deps.makeId(),
    trackId,
    sourceSha256,
    providers: selected.map(({ id, name, version, capabilities, legalStatus, evaluation }) => ({
      id,
      name: name ?? id,
      version,
      capabilities,
      legalStatus: legalStatus ?? evaluation?.status ?? 'unreviewed'
    })),
    createdAt,
    updatedAt: createdAt
  }
  await deps.store.saveBenchmark(benchmark)
  for (const provider of selected) await saveBenchmarkJob(deps, benchmark, provider, createdAt)
  return processorBenchmarkView(deps.store, benchmark)
}

async function saveBenchmarkJob(
  deps: BenchmarkDeps,
  benchmark: ProcessorBenchmarkRun,
  provider: BenchmarkProvider,
  createdAt: number
): Promise<void> {
  const config: ProcessorJob['config'] = {}
  await deps.store.saveJob({
    id: deps.makeId(),
    trackId: benchmark.trackId,
    capabilities: provider.capabilities,
    pluginId: provider.id,
    pluginVersion: provider.version,
    status: 'queued',
    attempts: 0,
    progress: 0,
    sourceSha256: benchmark.sourceSha256,
    config,
    configHash: processorConfigHash(config),
    createdAt,
    updatedAt: createdAt,
    benchmarkId: benchmark.id
  })
}
