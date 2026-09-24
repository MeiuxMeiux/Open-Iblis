// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Engine facts shared between main and the renderer: runtime profiles, the
// Create-facing capability surface, and the installed-engine summaries the
// picker cards render. Split from contract.ts for the size cap.

import type {
  EngineAdvancedControlV2,
  EngineCommonControlV2,
  EngineOutputRoleV2,
  EngineSolver
} from '@iblis/plugin-sdk'

// A profile is an honest, runtime-derived recipe. `validated` is the exact
// upstream preset exposed by /props; `expert` is an explicitly bounded
// experiment around that same installed model, never a fictional quality tier.
export interface EngineProfile {
  id: string
  name: string
  kind: 'validated' | 'expert'
  synthModel: string
  steps: { default: number; min: number; max: number }
  guidance: { default: number; min: number; max: number }
  shift: number
  solver: EngineSolver
  // Contract-v2 profiles are fixed recipes: steps/guidance/shift/solver above
  // are placeholders the renderer must not present as tunable.
  fixedRecipe?: true
}

// Advanced control values keyed by descriptor control id.
export type AdvancedValues = Record<string, boolean | number | string>

// What the selected engine can actually take for Create, derived from signed
// facts (v2 descriptor) or the ACE compatibility driver's known surface. The
// renderer shows a control only when the engine declares it.
export interface EngineCapabilities {
  protocol: 1 | 2
  operation: string
  lyrics: 'none' | 'plain' | 'ace-structured'
  // ACE can write its own lyrics; v2 engines only take supplied lyrics.
  autoLyrics: boolean
  styles: boolean
  seed: boolean
  commonControls: EngineCommonControlV2[]
  advancedControls: EngineAdvancedControlV2[]
  duration: { minSec: number; maxSec: number }
  // ACE-era native tuning (LM model, steps, solver, rewrite) exists only on
  // the compatibility driver; v2 engines expose bounded advanced controls.
  nativeTuning: boolean
  outputs: EngineOutputRoleV2[]
}

export interface EngineRuntimeInfo {
  version: string
  lmModels: string[]
  synthModels: string[]
  adapters: string[]
  solvers: EngineSolver[]
  defaultLmModel: string
  defaultSynthModel: string
  defaultTemperature: number
}

// Live sidecar facts only. Manifest presets are intentionally absent: pack
// 0.1.4's old Fast/Balanced/Quality labels do not describe its one turbo DiT.
export interface EngineInfo {
  id: string | null
  running: boolean
  // On-demand engines start when a take runs; a stopped sidecar is a ready
  // state for them, not an error, and Create must not grey the form.
  startsOnDemand?: boolean
  profiles: EngineProfile[]
  capabilities?: EngineCapabilities
  runtime?: EngineRuntimeInfo
  runtimeError?: string
}

// One installed engine as the picker sees it. `selected` marks the current
// default target for new takes; queued work keeps its own admitted target.
export interface InstalledEngineSummary {
  id: string
  name: string
  version: string
  protocol: 1 | 2
  running: boolean
  selected: boolean
  // Card facts, all from the signed manifest/descriptor or supervisor state.
  publisher: string
  license: string
  execution: 'local-sidecar'
  startsOnDemand: boolean
  readiness: 'running' | 'busy' | 'ready' | 'stopped'
  installBytes: number
  models: string[]
  operations: string[]
  styles: boolean
  lyrics: boolean
  duration: { minSec: number; maxSec: number } | null
}
