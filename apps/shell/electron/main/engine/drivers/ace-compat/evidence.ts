// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GenerateRequest } from '@iblis/plugin-sdk'
import type {
  GenerationPhaseName,
  GenerationPhaseTiming,
  GenerationTraceEvent
} from '../../../../../shared/generation-record'

export interface GenerationEngineIdentity {
  id: string
  version: string | null
}

export interface EngineGenerationEvidence {
  jobId: string
  request: GenerateRequest
  startedAt: number
  finishedAt: number
  phases: GenerationPhaseTiming[]
  trace: GenerationTraceEvent[]
  resolvedSynthText: string
  effectiveRequest: Record<string, unknown>
  engine: GenerationEngineIdentity
}

export interface GenerationPhaseRecorder {
  startedAt: number
  phases: GenerationPhaseTiming[]
  trace: GenerationTraceEvent[]
  start(phase: GenerationPhaseName, engineJobId?: string): void
  finish(): void
  setEngineJobId(engineJobId: string): void
}

// Keeps phase timing and trace bookkeeping together so the engine state
// machine only describes protocol transitions. Arrays are intentionally live:
// completion persistence reads the same records built throughout the run.
export function createGenerationPhaseRecorder(now: () => number): GenerationPhaseRecorder {
  const startedAt = now()
  const phases: GenerationPhaseTiming[] = []
  const trace: GenerationTraceEvent[] = [{ at: startedAt, event: 'started' }]
  let current: { phase: GenerationPhaseName; startedAt: number; engineJobId?: string } | null = null

  return {
    startedAt,
    phases,
    trace,
    start(phase: GenerationPhaseName, engineJobId?: string): void {
      current = { phase, startedAt: now(), ...(engineJobId ? { engineJobId } : {}) }
      trace.push({
        at: current.startedAt,
        event: 'phase_started',
        phase,
        ...(engineJobId ? { engineJobId } : {})
      })
    },
    finish(): void {
      if (!current) return
      const finishedAt = now()
      phases.push({
        phase: current.phase,
        startedAt: current.startedAt,
        finishedAt,
        durationMs: finishedAt - current.startedAt,
        ...(current.engineJobId ? { engineJobId: current.engineJobId } : {})
      })
      trace.push({
        at: finishedAt,
        event: 'phase_finished',
        phase: current.phase,
        ...(current.engineJobId ? { engineJobId: current.engineJobId } : {})
      })
      current = null
    },
    setEngineJobId(engineJobId: string): void {
      if (current) current.engineJobId = engineJobId
    }
  }
}
