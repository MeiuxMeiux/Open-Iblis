// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  BpmDetectionValueV1,
  EvaluationStatus,
  KeyDetectionValueV1,
  ProcessorEvaluationV1,
  ProcessorAnalysisCapability,
  ProcessorErrorV1
} from '@iblis/plugin-sdk'

type ProcessorJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

// This is deliberately metadata-only. The renderer never receives an audio
// path, plugin configuration secret, or arbitrary provider-defined JSON.
interface ProcessorResultRecordBase {
  trackId: string
  pluginId: string
  pluginVersion: string
  resultSchema: 1
  sourceSha256: string
  configHash: string
  computedAt: number
  computeMs: number
}

export type ProcessorResultRecord =
  | (ProcessorResultRecordBase & { capability: 'bpm-detect'; value: BpmDetectionValueV1 })
  | (ProcessorResultRecordBase & { capability: 'key-detect'; value: KeyDetectionValueV1 })

export interface ProcessorJobView {
  id: string
  trackId: string
  capabilities: ProcessorAnalysisCapability[]
  pluginId: string
  pluginVersion: string
  status: ProcessorJobStatus
  attempts: number
  progress: number
  error?: ProcessorErrorV1
  createdAt: number
  updatedAt: number
  // Present only for work explicitly queued by the local benchmark.
  benchmarkId?: string
}

// Safe, active processor metadata for Settings. This is intentionally not a
// manifest: executable details and provider-defined configuration stay main-only.
// 'built-in' providers ship inside the shell and run in a worker thread; they
// have no installer lifecycle and no executable.
export interface ProcessorProviderView {
  id: string
  name: string
  version: string
  capabilities: ProcessorAnalysisCapability[]
  runtime: 'native-sidecar' | 'built-in'
  legalStatus: EvaluationStatus | 'unreviewed'
  requiresAcknowledgement: boolean
  acknowledged: boolean
}

// Deliberately safe subset of an installed processor's manifest for the
// provider-details drawer. It excludes executable configuration, install
// locations, asset URLs, and arbitrary provider settings.
export interface ProcessorProviderDetail extends ProcessorProviderView {
  codeLicense: string
  author: string
  authorUrl?: string
  evaluation?: ProcessorEvaluationV1
}

// Acknowledgements bind to the exact provider build and upstream revision.
// Updating either makes the host request the provider's current disclosure
// again before it can be selected.
export interface ProcessorAcknowledgement {
  version: string
  upstreamRevision: string
  acknowledgedAt: number
}

export interface ProcessorSettings {
  defaults: Partial<Record<ProcessorAnalysisCapability, string>>
  providers: ProcessorProviderView[]
  acknowledgements: Record<string, ProcessorAcknowledgement>
}

// A benchmark is independent from BPM/key defaults and records the exact
// provider builds and immutable audio identity selected by the user.
export interface ProcessorBenchmarkProvider {
  id: string
  name: string
  version: string
  capabilities: ProcessorAnalysisCapability[]
  legalStatus: EvaluationStatus | 'unreviewed'
}

export interface ProcessorBenchmarkRun {
  id: string
  trackId: string
  sourceSha256: string
  providers: ProcessorBenchmarkProvider[]
  createdAt: number
  updatedAt: number
}

export interface ProcessorBenchmarkView extends ProcessorBenchmarkRun {
  jobs: ProcessorJobView[]
  // Processor protocol v1 does not expose memory measurements. Null keeps
  // this gap explicit in comparisons and in the portable JSON export.
  results: (ProcessorResultRecord & { peakMemoryBytes: number | null })[]
}

// Compact detected facts for Library rows. For each capability we surface the
// newest stored result from the CURRENT default provider only: benchmark runs
// and results from since-replaced providers stay in Track detail, so a row
// badge never silently mixes provenance. No default provider = no badge.
export interface DetectedTrackFacts {
  bpm?: number
  keyPitchClass?: string
  keyMode?: 'major' | 'minor'
}

export function detectedTrackFacts(
  results: ProcessorResultRecord[],
  defaults: Partial<Record<ProcessorAnalysisCapability, string>>
): DetectedTrackFacts | null {
  const facts: DetectedTrackFacts = {}
  for (const capability of ['bpm-detect', 'key-detect'] as const) {
    const provider = defaults[capability]
    if (!provider) continue
    const newest = results
      .filter((result) => result.capability === capability && result.pluginId === provider)
      .sort((a, b) => b.computedAt - a.computedAt)[0]
    if (!newest) continue
    if (newest.capability === 'bpm-detect') {
      facts.bpm = newest.value.bpm
    } else {
      facts.keyPitchClass = newest.value.pitchClass
      facts.keyMode = newest.value.mode
    }
  }
  return facts.bpm !== undefined || facts.keyPitchClass !== undefined ? facts : null
}
