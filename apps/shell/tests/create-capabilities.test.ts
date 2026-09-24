// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Renderer-side capability gating for Create (roadmap 4D): advanced values
// reconcile to the selected engine's declared controls, only changed values
// travel, and a built config never carries keys the engine did not declare.

import { describe, expect, it } from 'vitest'
import type { EngineCapabilities } from '../shared/contract'
import { changedAdvanced, fitConfig, reconcileAdvanced } from '../src/lib/capabilities'

const v2: EngineCapabilities = {
  protocol: 2,
  operation: 'music.generate',
  lyrics: 'none',
  autoLyrics: false,
  styles: false,
  seed: true,
  commonControls: ['bpm'],
  advancedControls: [
    {
      id: 'canvas',
      label: 'Canvas',
      kind: 'enum',
      values: ['miniature', 'mural'],
      default: 'miniature'
    },
    { id: 'layers', label: 'Layers', kind: 'integer', min: 1, max: 8, default: 3 },
    { id: 'crackle', label: 'Crackle', kind: 'boolean', default: false }
  ],
  duration: { minSec: 1, maxSec: 120 },
  nativeTuning: false,
  outputs: ['mix', 'preview']
}

const v1: EngineCapabilities = {
  protocol: 1,
  operation: 'music.generate',
  lyrics: 'ace-structured',
  autoLyrics: true,
  styles: true,
  seed: true,
  commonControls: ['negativePrompt', 'bpm', 'keyscale', 'timeSignature'],
  advancedControls: [],
  duration: { minSec: 4, maxSec: 240 },
  nativeTuning: true,
  outputs: ['mix']
}

describe('Create capability gating', () => {
  it('reconciles advanced values to declared controls with defaults for the rest', () => {
    expect(reconcileAdvanced({ layers: 5, canvas: 'fresco', ghost: true }, v2)).toEqual({
      canvas: 'miniature',
      layers: 5,
      crackle: false
    })
    expect(reconcileAdvanced({ layers: 2.5 }, v2).layers).toBe(3)
    expect(reconcileAdvanced({ layers: 5 }, v1)).toEqual({})
    expect(reconcileAdvanced({ layers: 5 }, null)).toEqual({})
  })

  it('sends only values that differ from the descriptor default', () => {
    expect(changedAdvanced({ canvas: 'miniature', layers: 3, crackle: false }, v2)).toBeUndefined()
    expect(changedAdvanced({ canvas: 'mural', layers: 3, crackle: true }, v2)).toEqual({
      canvas: 'mural',
      crackle: true
    })
  })

  it('trims a config to the engine dialect', () => {
    const built = {
      negativePrompt: 'x',
      bpm: 120,
      steps: 8,
      adapter: 'style',
      adapterScale: 1,
      autoLyrics: true,
      advanced: { layers: 5 }
    }
    expect(fitConfig(built, v2)).toEqual({ bpm: 120, advanced: { layers: 5 } })
    expect(fitConfig(built, v1)).toEqual({
      negativePrompt: 'x',
      bpm: 120,
      steps: 8,
      adapter: 'style',
      adapterScale: 1,
      autoLyrics: true
    })
    expect(fitConfig(built, null)).toBe(built)
    expect(fitConfig({ advanced: { layers: 5 } }, v1)).toBeUndefined()
  })
})
