// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { EngineInfo, EngineProfile } from '../shared/contract'
import { reconcileDraftEngine } from '../src/lib/profile-reconciliation'

const turbo: EngineProfile = {
  id: 'turbo-expert',
  name: 'Turbo experiment',
  kind: 'expert',
  synthModel: 'turbo.gguf',
  steps: { default: 8, min: 1, max: 20 },
  guidance: { default: 1, min: 1, max: 1 },
  shift: 3,
  solver: 'euler'
}

const sft: EngineProfile = {
  id: 'sft-experiment',
  name: 'SFT experiment',
  kind: 'expert',
  synthModel: 'sft.gguf',
  steps: { default: 50, min: 50, max: 50 },
  guidance: { default: 1, min: 1, max: 7 },
  shift: 1,
  solver: 'euler'
}

function info(profiles: EngineProfile[], synthModels: string[]): EngineInfo {
  return {
    id: 'mx.iblis.engine.acestep',
    running: true,
    profiles,
    runtime: {
      version: 'test',
      lmModels: ['lm-default.gguf'],
      synthModels,
      adapters: [],
      solvers: ['euler'],
      defaultLmModel: 'lm-default.gguf',
      defaultSynthModel: synthModels[0]!,
      defaultTemperature: 0.85
    }
  }
}

describe('Create draft runtime reconciliation', () => {
  it('fully resets an unavailable SFT profile after an engine rollback', () => {
    const draft = reconcileDraftEngine(info([turbo], ['turbo.gguf']), {
      presetId: sft.id,
      steps: 50,
      guidance: 5,
      shift: 1,
      solver: 'euler',
      synthModel: sft.synthModel,
      lmModel: 'removed-lm.gguf',
      adapter: 'removed-adapter',
      adapterScale: 0.5
    })

    expect(draft).toMatchObject({
      presetId: 'turbo-expert',
      steps: 8,
      guidance: 1,
      shift: 3,
      solver: 'euler',
      synthModel: 'turbo.gguf',
      lmModel: 'lm-default.gguf',
      adapter: '',
      adapterScale: null
    })
  })
})
