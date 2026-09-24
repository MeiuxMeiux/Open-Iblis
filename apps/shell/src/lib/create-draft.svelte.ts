// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GenerateRequest } from '@iblis/plugin-sdk'
import type { EngineCapabilities, EngineInfo, EngineProfile } from '../../shared/contract'
import type { RemixPrefill } from './library.svelte'
import { changedAdvanced, fitConfig, reconcileAdvanced } from './capabilities'
import { reconcileDraftEngine } from './profile-reconciliation'
import { Steering } from './views/steering.svelte'

export type DraftRequestResult =
  { ok: true; request: GenerateRequest } | { ok: false; error: string }

export class CreateDraft {
  prompt = $state('')
  presetId = $state('')
  seedText = $state('')
  lengthSec = $state(30)
  steering = $state(new Steering())
  // The selected engine's signed Create surface; null until main reports it.
  capabilities = $state<EngineCapabilities | null>(null)

  ensureEngineInfo(info: EngineInfo): void {
    const next = reconcileDraftEngine(info, {
      presetId: this.presetId,
      steps: this.steering.steps,
      guidance: this.steering.guidance,
      shift: this.steering.shift,
      solver: this.steering.solver,
      lmModel: this.steering.lmModel,
      synthModel: this.steering.synthModel,
      adapter: this.steering.adapter,
      adapterScale: this.steering.adapterScale
    })
    this.presetId = next.presetId
    this.steering.steps = next.steps
    this.steering.guidance = next.guidance
    this.steering.shift = next.shift
    this.steering.solver = next.solver
    this.steering.lmModel = next.lmModel
    this.steering.synthModel = next.synthModel
    this.steering.adapter = next.adapter
    this.steering.adapterScale = next.adapterScale
    this.capabilities = info.capabilities ?? null
    this.steering.advanced = reconcileAdvanced(this.steering.advanced, this.capabilities)
    const duration = this.capabilities?.duration
    if (duration) {
      this.lengthSec = Math.min(duration.maxSec, Math.max(duration.minSec, this.lengthSec))
    }
  }

  selectProfile(profile: EngineProfile): void {
    this.presetId = profile.id
    this.steering.steps = profile.steps.default
    this.steering.guidance = profile.guidance.default
    this.steering.shift = profile.shift
    this.steering.solver = profile.solver
    this.steering.synthModel = profile.synthModel
  }

  applyRemix(remix: RemixPrefill): void {
    this.prompt = remix.prompt
    this.presetId = remix.preset
    this.seedText = remix.seed === undefined ? '' : String(remix.seed)
    this.lengthSec = remix.durationSec
    this.steering = new Steering()
    this.steering.applyRemix(remix)
  }

  buildRequest(): DraftRequestResult {
    const prompt = this.prompt.trim()
    if (!prompt) return { ok: false, error: 'Enter a prompt first.' }

    const seed = optionalSeed(this.seedText)
    if (typeof seed === 'string') return { ok: false, error: `Synthesis seed ${seed}` }
    const lmSeed = optionalSeed(this.steering.lmSeedText)
    if (typeof lmSeed === 'string') return { ok: false, error: `LM seed ${lmSeed}` }

    const caps = this.capabilities
    const baseConfig = this.steering.buildConfig()
    const advanced = changedAdvanced(this.steering.advanced, caps)
    const config = fitConfig(
      {
        ...baseConfig,
        ...(lmSeed !== undefined && caps?.nativeTuning !== false ? { lmSeed } : {}),
        ...(advanced ? { advanced } : {})
      },
      caps
    )
    const lyrics = caps?.lyrics === 'none' ? undefined : this.steering.requestLyrics()
    return {
      ok: true,
      request: {
        prompt,
        durationSec: this.lengthSec,
        preset: this.presetId,
        ...(seed !== undefined && caps?.seed !== false ? { seed } : {}),
        ...(lyrics !== undefined ? { lyrics } : {}),
        ...(config && Object.keys(config).length > 0 ? { config } : {})
      }
    }
  }
}

function optionalSeed(text: string): number | undefined | string {
  if (!text.trim()) return undefined
  const value = Number(text.trim())
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    return 'must be a whole number from 0 to 4294967295.'
  }
  return value
}

// Create is routed by conditional mounting, so the draft belongs at module
// scope. This singleton keeps every visible field stable through navigation.
export const createDraft = new CreateDraft()
