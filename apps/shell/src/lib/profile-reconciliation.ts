// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EngineSolver } from '@iblis/plugin-sdk'
import type { EngineInfo, EngineProfile } from '../../shared/contract'

export interface DraftEngineState {
  presetId: string
  steps: number | null
  guidance: number | null
  shift: number | null
  solver: EngineSolver | ''
  lmModel: string
  synthModel: string
  adapter: string
  adapterScale: number | null
}

export interface ReconciledDraftEngineState extends DraftEngineState {
  profile?: EngineProfile
}

export function reconcileDraftEngine(
  info: EngineInfo,
  current: DraftEngineState
): ReconciledDraftEngineState {
  let profile = info.profiles.find((candidate) => candidate.id === current.presetId)
  const changed = !profile
  if (!profile) {
    const requestedKind = current.steps !== null && current.steps !== 8 ? 'expert' : 'validated'
    profile =
      info.profiles.find((candidate) => candidate.kind === requestedKind) ?? info.profiles[0]
  }
  const runtime = info.runtime
  const adapter = runtime?.adapters.includes(current.adapter) ? current.adapter : ''
  return {
    presetId: profile?.id ?? current.presetId,
    steps: profile && (changed || current.steps === null) ? profile.steps.default : current.steps,
    guidance:
      profile && (changed || current.guidance === null)
        ? profile.guidance.default
        : current.guidance,
    shift: profile && (changed || current.shift === null) ? profile.shift : current.shift,
    solver: profile && (changed || !current.solver) ? profile.solver : current.solver,
    lmModel: runtime?.lmModels.includes(current.lmModel)
      ? current.lmModel
      : (runtime?.defaultLmModel ?? ''),
    synthModel: profile?.synthModel ?? runtime?.defaultSynthModel ?? '',
    adapter,
    adapterScale: adapter ? current.adapterScale : null,
    ...(profile ? { profile } : {})
  }
}
