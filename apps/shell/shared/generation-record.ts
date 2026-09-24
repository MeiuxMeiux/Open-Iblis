// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GenerateRequest } from '@iblis/plugin-sdk'
import type { AudioAnalysis, LibraryTrack, WavFacts } from './contract'
import type { ProcessorJobView, ProcessorResultRecord } from './processors'

export type GenerationPhaseName = 'lm' | 'synth' | 'finishing'

export interface GenerationPhaseTiming {
  phase: GenerationPhaseName
  startedAt: number
  finishedAt: number
  durationMs: number
  engineJobId?: string
}

export interface GenerationTraceEvent {
  at: number
  event: 'started' | 'phase_started' | 'phase_finished' | 'audio_validated'
  phase?: GenerationPhaseName
  engineJobId?: string
}

type ResolvedRecipeValue = string | number | boolean
export type ResolvedGenerationRecipe = Record<string, ResolvedRecipeValue>

interface GenerationAnalysisSummary {
  sourceSha256?: string
  peakAmplitude: number
  rmsAmplitude: number
  clippedSamples: number
  audible: AudioAnalysis['audible']
}

export interface GenerationRecordV1 {
  schema: 1
  jobId: string
  request: GenerateRequest
  startedAt: number
  finishedAt: number
  engine: { pluginId: string; pluginVersion: string | null }
  phases: GenerationPhaseTiming[]
  trace: GenerationTraceEvent[]
  resolvedRecipes: ResolvedGenerationRecipe[]
  result: { status: 'done'; trackId: string; format: 'wav' }
  output: {
    codec: 'wav'
    sizeBytes: number
    audio: WavFacts
    analysis?: GenerationAnalysisSummary
  }
}

export interface TrackDetail {
  track: LibraryTrack
  provenance: 'recorded' | 'legacy' | 'imported'
  generation?: GenerationRecordV1
  analysis?: AudioAnalysis
  analysisError?: string
  // Detected evidence is distinct from requested/resolved generation values.
  processorResults?: ProcessorResultRecord[]
  // Durable, path-free work state for the selected detection provider.
  processorJobs?: ProcessorJobView[]
}
