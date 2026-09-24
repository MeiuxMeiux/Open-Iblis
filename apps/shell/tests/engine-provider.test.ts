// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Engine contract v2 slices 2 + 5 (planning packet 2026-07-21): shared host
// code speaks only the EngineProvider interface, the registry routes by
// protocol facts, and everything engine-flavored lives in explicitly named
// drivers. These tests pin the seam so a future engine cannot be added by
// re-teaching the queue an engine dialect.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { GenerateRequest } from '@iblis/plugin-sdk'

// The drivers wire completed takes into the Library, which drags in
// renderer-facing Electron surface the stub does not model. The seam under
// test never reaches it.
vi.mock('../electron/main/library', () => ({
  addGeneratedTrack: vi.fn(),
  recordPromptUse: vi.fn(),
  saveTrackGeneration: vi.fn()
}))

import { engineProvider } from '../electron/main/engine'

describe('engine provider registry', () => {
  it('routes through one registry object with the full provider surface', () => {
    const provider = engineProvider()
    expect(provider.id).toBe('engine-registry')
    expect(engineProvider()).toBe(provider)
    for (const method of [
      'engineInfo',
      'activeEngineId',
      'requestError',
      'canonicalRequestError',
      'validBlueprint',
      'isComparisonControl',
      'comparisonRecipeError',
      'resolveQueuedRequest',
      'resolveComparisonPair',
      'startGenerate',
      'jobState',
      'settled',
      'cancelDirect',
      'abortActive',
      'blueprint',
      'currentTarget',
      'listEngineSummaries',
      'selectEngine'
    ] as const) {
      expect(typeof provider[method], method).toBe('function')
    }
  })

  it('exposes the driver recipe rules unchanged through the interface', () => {
    const provider = engineProvider()
    expect(provider.requestError({ nonsense: true })).not.toBeNull()
    expect(provider.canonicalRequestError({})).not.toBeNull()
    expect(provider.validBlueprint('not a blueprint')).toBe(false)
    expect(provider.validBlueprint(JSON.stringify([{ audio_codes: 'codes', caption: 'x' }]))).toBe(
      true
    )
    const control = { preset: 'turbo-validated' } as GenerateRequest
    const candidate = { preset: 'turbo-expert' } as GenerateRequest
    expect(provider.isComparisonControl(control)).toBe(true)
    expect(provider.isComparisonControl(candidate)).toBe(false)
    expect(provider.comparisonRecipeError(candidate, control)).toContain(
      'not the validated Turbo recipe'
    )
  })

  it('accepts canonical documents from either dialect in store rules', () => {
    const provider = engineProvider()
    // A canonical v2 recipe (no ACE tuning tuple) must survive rehydration.
    expect(
      provider.canonicalRequestError({
        prompt: 'a quiet miniature',
        durationSec: 20,
        preset: 'sketchbook',
        seed: 7,
        config: { bpm: 96 }
      })
    ).toBeNull()
    // Garbage still fails both dialects.
    expect(provider.canonicalRequestError({ prompt: '', durationSec: 20 })).not.toBeNull()
  })
})

describe('shared host code stays engine-neutral', () => {
  const SHARED_FILES = [
    'generation-queue/index.ts',
    'generation-queue/store.ts',
    'generation-queue/comparison.ts',
    'generation-queue/scheduler.ts',
    'generation-queue/runner.ts',
    'generation-queue/recovery.ts',
    'generation-queue/leases.ts',
    'generation-queue/snapshot.ts',
    'generation-queue/types.ts',
    'engine/index.ts',
    'engine/provider.ts',
    'engine/defaults.ts',
    'ipc.ts'
  ]
  // No engine dialect may leak back into shared code: no driver-internal
  // imports (the registry's own registration lines are the exception), no
  // engine endpoints, and no engine id, profile, or model naming.
  const FORBIDDEN = [
    'turbo-validated',
    'turbo-expert',
    'sft-experiment',
    "'/lm'",
    "'/synth'",
    "'/props'",
    'ace-server',
    'acestep',
    'engine.fixture',
    'sketchbook',
    'pastiche'
  ]

  it('never names an engine endpoint, profile, id, or driver internal', () => {
    for (const file of SHARED_FILES) {
      const source = readFileSync(join(__dirname, '../electron/main', file), 'utf8')
      for (const token of FORBIDDEN) {
        expect(source.includes(token), `${file} must not contain ${token}`).toBe(false)
      }
      if (file !== 'engine/index.ts') {
        expect(
          source.includes('drivers/ace-compat') || source.includes('drivers/v2'),
          `${file} must not import driver internals`
        ).toBe(false)
      }
    }
  })
})
