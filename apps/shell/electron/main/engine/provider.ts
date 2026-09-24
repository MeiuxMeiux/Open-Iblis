// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The internal engine provider seam (engine contract v2 slice 2, planning
// packet 2026-07-21). Shared host code — the generation queue, its persisted
// store, and IPC — speaks only this interface. Everything that knows the
// ACE-Step dialect (endpoints, model-name regexes, profile tuples, comparison
// recipes, blueprint shapes) lives behind it in an explicitly named
// compatibility driver under ./drivers/. Adding a second engine means
// implementing this interface, never branching on an engine id in shared code.

import type { GenerateRequest, GenerateResponse, JobState } from '@iblis/plugin-sdk'
import type { EngineInfo, IpcResult } from '../../../shared/contract'
import type { QueueComparisonVariant } from '../../../shared/generation-queue'

// The subset of provider knowledge the persisted queue store needs to accept
// or reject rehydrated documents. Injected so the store module itself stays
// engine-neutral and unit-testable without Electron.
export interface QueueRecipeRules {
  canonicalRequestError(value: unknown): string | null
  validBlueprint(text: string): boolean
  isComparisonControl(request: GenerateRequest): boolean
  comparisonRecipeError(control: GenerateRequest, candidate: GenerateRequest): string | null
}

export interface EngineProvider extends QueueRecipeRules {
  // Stable provider identity, recorded nowhere yet — it names the driver in
  // logs and tests, not a user-facing choice.
  readonly id: string

  // Discovery: live runtime facts and derived profiles for the renderer.
  engineInfo(): Promise<EngineInfo>
  activeEngineId(): string | null

  // Admission: structural validation of an untrusted request, and the single
  // place omitted defaults and random seeds become a concrete queued recipe.
  requestError(value: unknown): string | null
  resolveQueuedRequest(request: GenerateRequest): Promise<GenerateRequest>
  // Resolve a draft into a blind A/B pair: the provider owns what a valid
  // control recipe is and how a variant derives from it.
  resolveComparisonPair(
    request: GenerateRequest,
    variant: QueueComparisonVariant
  ): Promise<{ control: GenerateRequest; candidate: GenerateRequest }>

  // Execution: the queue drives one job at a time through these.
  startGenerate(request: GenerateRequest, blueprint?: string): IpcResult<GenerateResponse>
  jobState(jobId: string): IpcResult<JobState>
  settled(jobId: string): Promise<JobState | undefined>
  cancelDirect(jobId: string): Promise<void>
  abortActive(code: string, message: string): Promise<string | null>
  blueprint(jobId: string): string | undefined
}
