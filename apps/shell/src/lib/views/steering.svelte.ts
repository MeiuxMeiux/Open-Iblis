// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Steering form state for the Create view, extracted so Generate.svelte stays
// within the component cap: the vocals mode, negative prompt, and the honest
// engine knobs (bpm/key/steps/guidance/rewrite), plus the mapping to and from
// GenerateRequest fields (buildConfig / applyRemix).

import type { EngineSolver, GenerateConfig } from '@iblis/plugin-sdk'
import type { AdvancedValues } from '../../../shared/engine-info'
import type { RemixPrefill } from '../library.svelte'

export type { AdvancedValues }

// Vocals is three-way because the engine has three real modes: the
// [Instrumental] sentinel, user lyrics, or the LM writing its own.
export type VocalsMode = 'instrumental' | 'lyrics' | 'auto'

export class Steering {
  vocals = $state<VocalsMode>('instrumental')
  lyricsText = $state('')
  negative = $state('')
  bpm = $state<number | null>(null)
  keyscale = $state('')
  steps = $state<number | null>(null)
  guidance = $state<number | null>(null)
  lmModel = $state('')
  synthModel = $state('')
  timeSignature = $state('')
  shift = $state<number | null>(null)
  solver = $state<EngineSolver | ''>('')
  adapter = $state('')
  adapterScale = $state<number | null>(null)
  lmSeedText = $state('')
  rewritePrompt = $state(true)
  advancedOpen = $state(false)
  // Contract-v2 advanced controls by descriptor id; reconciled against the
  // selected engine's capabilities so a stale id never reaches admission.
  advanced = $state<AdvancedValues>({})

  // Restore a remixed track's exact steering; opens Advanced if it used any.
  applyRemix(remix: RemixPrefill): void {
    if (remix.lyrics) {
      this.vocals = 'lyrics'
      this.lyricsText = remix.lyrics
    }
    const c = remix.config
    if (!c) return
    if (c.autoLyrics && !remix.lyrics) this.vocals = 'auto'
    if (c.negativePrompt) this.negative = c.negativePrompt
    if (c.bpm !== undefined) this.bpm = c.bpm
    if (c.keyscale) this.keyscale = c.keyscale
    if (c.steps !== undefined) this.steps = c.steps
    if (c.guidance !== undefined) this.guidance = c.guidance
    if (c.lmModel) this.lmModel = c.lmModel
    if (c.synthModel) this.synthModel = c.synthModel
    if (c.timeSignature) this.timeSignature = c.timeSignature
    if (c.shift !== undefined) this.shift = c.shift
    if (c.solver) this.solver = c.solver
    if (c.adapter) this.adapter = c.adapter
    if (c.adapterScale !== undefined) this.adapterScale = c.adapterScale
    if (c.lmSeed !== undefined) this.lmSeedText = String(c.lmSeed)
    if (c.rewritePrompt === false) this.rewritePrompt = false
    if (c.advanced) this.advanced = { ...c.advanced }
    this.advancedOpen =
      Object.keys(c.advanced ?? {}).length > 0 ||
      c.bpm !== undefined ||
      !!c.keyscale ||
      c.steps !== undefined ||
      c.guidance !== undefined ||
      !!c.lmModel ||
      !!c.synthModel ||
      !!c.timeSignature ||
      c.shift !== undefined ||
      !!c.solver ||
      !!c.adapter ||
      c.adapterScale !== undefined ||
      c.lmSeed !== undefined ||
      c.rewritePrompt === false
  }

  // GenerateRequest.lyrics: only user lyrics travel; the other modes ride in
  // config (absent = instrumental default, autoLyrics = engine-written).
  requestLyrics(): string | undefined {
    return this.vocals === 'lyrics' && this.lyricsText.trim() ? this.lyricsText : undefined
  }

  // Only what the user actually set travels; absent = engine default.
  buildConfig(): GenerateConfig | undefined {
    const c: GenerateConfig = {}
    if (this.negative.trim()) c.negativePrompt = this.negative.trim()
    if (this.vocals === 'auto') c.autoLyrics = true
    if (typeof this.bpm === 'number' && this.bpm > 0) c.bpm = this.bpm
    if (this.keyscale.trim()) c.keyscale = this.keyscale.trim()
    if (typeof this.steps === 'number' && this.steps > 0) c.steps = this.steps
    if (typeof this.guidance === 'number' && this.guidance > 0) c.guidance = this.guidance
    if (this.lmModel) c.lmModel = this.lmModel
    if (this.synthModel) c.synthModel = this.synthModel
    if (this.timeSignature.trim()) c.timeSignature = this.timeSignature.trim()
    if (typeof this.shift === 'number' && this.shift >= 0) c.shift = this.shift
    if (this.solver) c.solver = this.solver
    if (this.adapter) {
      c.adapter = this.adapter
      if (typeof this.adapterScale === 'number') c.adapterScale = this.adapterScale
    }
    if (!this.rewritePrompt) c.rewritePrompt = false
    if (Object.keys(this.advanced).length > 0) c.advanced = { ...this.advanced }
    return Object.keys(c).length > 0 ? c : undefined
  }
}
