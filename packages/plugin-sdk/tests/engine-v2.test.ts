// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

// Hostile-fixture tests for engine contract v2 (roadmap session 4B). The
// valid fixture is deliberately NOT ACE-shaped: different family, model
// names, phases, and an enum control ACE has no equivalent for. Every test
// then mutates one fact and expects the strict parsers to refuse it.

import { describe, expect, it } from 'vitest'
import {
  engineDescriptorNarrowingErrorsV2,
  engineOutputPathErrorsV2,
  engineRecipeErrorsV2,
  parseEngineDescriptorV2,
  parseEngineJobOutputsV2,
  parseEngineJobStateV2,
  parseEngineRecipeV2,
  type EngineDescriptorV2,
  type EngineRecipeV2
} from '../src/index.js'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const descriptor: EngineDescriptorV2 = {
  protocolVersion: 2,
  engineFamily: 'fixture-wave',
  models: [
    { id: 'wavecraft-small-fp16', revision: 'r2026.06' },
    { id: 'wavecraft-medium-fp16', revision: 'r2026.05' }
  ],
  profiles: [
    { id: 'fast-draft', label: 'Fast draft', modelId: 'wavecraft-small-fp16' },
    { id: 'studio', label: 'Studio quality', modelId: 'wavecraft-medium-fp16' }
  ],
  phases: ['warmup', 'compose', 'render'],
  operations: [
    {
      id: 'music.generate',
      inputs: [],
      prompt: { required: true, maxBytes: 4096 },
      lyrics: { dialect: 'plain', maxBytes: 8192 },
      duration: { minSec: 5, maxSec: 300 },
      outputs: [
        { role: 'mix', maxCount: 1 },
        { role: 'preview', maxCount: 1 }
      ],
      commonControls: ['bpm', 'negativePrompt'],
      advancedControls: [
        {
          id: 'texture',
          label: 'Texture density',
          kind: 'number',
          min: 0,
          max: 1,
          default: 0.5
        },
        {
          id: 'voicing',
          label: 'Voicing mode',
          kind: 'enum',
          values: ['sparse', 'lush'],
          default: 'sparse'
        }
      ],
      profileIds: ['fast-draft', 'studio'],
      adapters: { families: ['wavecraft-lora-v1'], maxActive: 2 },
      seed: 'uint32',
      cancellation: true
    },
    {
      id: 'music.extend',
      inputs: [
        { role: 'source', required: true, formats: ['wav'], maxDurationSec: 600, maxRanges: 2 }
      ],
      prompt: { required: false, maxBytes: 4096 },
      lyrics: null,
      duration: { minSec: 1, maxSec: 120 },
      outputs: [{ role: 'mix', maxCount: 1 }],
      commonControls: [],
      advancedControls: [],
      profileIds: ['fast-draft'],
      adapters: null,
      seed: 'none',
      cancellation: false
    }
  ]
}

const generateOp = descriptor.operations[0]!
const extendOp = descriptor.operations[1]!

const recipe: EngineRecipeV2 = {
  protocolVersion: 2,
  operation: 'music.generate',
  providerId: 'mx.iblis.engine.fixture',
  pluginVersion: '1.0.0',
  descriptorHash: 'a'.repeat(64),
  profileId: 'fast-draft',
  prompt: 'weightless choir over tape hiss',
  inputs: [],
  targetDurationSec: 60,
  advanced: { texture: 0.7, voicing: 'lush' },
  adapters: [{ libraryId: 'style-01HTX', scale: 0.8 }],
  seed: 12345
}

describe('parseEngineDescriptorV2', () => {
  it('accepts the non-ACE fixture', () => {
    expect(parseEngineDescriptorV2(clone(descriptor))).toEqual({
      ok: true,
      value: clone(descriptor)
    })
  })

  it('rejects unknown fields anywhere', () => {
    const top = clone(descriptor) as unknown as Record<string, unknown>
    top.telemetry = { url: 'https://evil.example' }
    expect(parseEngineDescriptorV2(top)).toMatchObject({ ok: false })

    const nested = clone(descriptor)
    ;(nested.operations[0] as unknown as Record<string, unknown>).rendererComponent = 'x.js'
    const parsed = parseEngineDescriptorV2(nested)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('unknown field')
  })

  it('rejects oversized collections and text', () => {
    const tooManyModels = clone(descriptor)
    tooManyModels.models = Array.from({ length: 65 }, (_, index) => ({
      id: `model-${index}`,
      revision: 'r1'
    }))
    expect(parseEngineDescriptorV2(tooManyModels).ok).toBe(false)

    const hugeHelp = clone(descriptor)
    ;(hugeHelp.operations[0]!.advancedControls[0] as { help?: string }).help = 'x'.repeat(4096)
    expect(parseEngineDescriptorV2(hugeHelp).ok).toBe(false)
  })

  it('rejects bad ranges and non-finite numbers', () => {
    const inverted = clone(descriptor)
    inverted.operations[0]!.duration = { minSec: 500, maxSec: 5 }
    expect(parseEngineDescriptorV2(inverted).ok).toBe(false)

    const infinite = clone(descriptor) as unknown as {
      operations: { advancedControls: Record<string, unknown>[] }[]
    }
    infinite.operations[0]!.advancedControls[0]!.max = Number.POSITIVE_INFINITY
    expect(parseEngineDescriptorV2(infinite).ok).toBe(false)
  })

  it('rejects malformed controls', () => {
    const badKind = clone(descriptor) as unknown as {
      operations: { advancedControls: Record<string, unknown>[] }[]
    }
    badKind.operations[0]!.advancedControls[0]!.kind = 'json-editor'
    expect(parseEngineDescriptorV2(badKind).ok).toBe(false)

    const strayDefault = clone(descriptor)
    const voicing = strayDefault.operations[0]!.advancedControls[1] as { default: string }
    voicing.default = 'orchestral'
    expect(parseEngineDescriptorV2(strayDefault).ok).toBe(false)

    const duplicate = clone(descriptor)
    duplicate.operations[0]!.advancedControls.push(
      clone(duplicate.operations[0]!.advancedControls[0]!)
    )
    expect(parseEngineDescriptorV2(duplicate).ok).toBe(false)
  })

  it('rejects undeclared profile and model references', () => {
    const ghostProfile = clone(descriptor)
    ghostProfile.operations[0]!.profileIds = ['fast-draft', 'ghost']
    expect(parseEngineDescriptorV2(ghostProfile).ok).toBe(false)

    const ghostModel = clone(descriptor)
    ghostModel.profiles[0]!.modelId = 'not-installed'
    expect(parseEngineDescriptorV2(ghostModel).ok).toBe(false)
  })
})

describe('engineDescriptorNarrowingErrorsV2', () => {
  it('accepts an identical or narrowed live descriptor', () => {
    expect(engineDescriptorNarrowingErrorsV2(descriptor, clone(descriptor))).toEqual([])
    const narrowed = clone(descriptor)
    narrowed.models.pop()
    narrowed.profiles.pop()
    narrowed.operations = [narrowed.operations[1]!]
    expect(engineDescriptorNarrowingErrorsV2(descriptor, narrowed)).toEqual([])
  })

  it('rejects every broadened runtime claim', () => {
    const addOperation = clone(descriptor)
    addOperation.operations.push({ ...clone(extendOp), id: 'music.inpaint' })
    expect(engineDescriptorNarrowingErrorsV2(descriptor, addOperation)).not.toEqual([])

    const addModel = clone(descriptor)
    addModel.models.push({ id: 'wavecraft-xl', revision: 'r1' })
    expect(engineDescriptorNarrowingErrorsV2(descriptor, addModel)).not.toEqual([])

    const raiseDuration = clone(descriptor)
    raiseDuration.operations[0]!.duration = { minSec: 5, maxSec: 3000 }
    expect(engineDescriptorNarrowingErrorsV2(descriptor, raiseDuration)).not.toEqual([])

    const widenEnum = clone(descriptor)
    ;(widenEnum.operations[0]!.advancedControls[1] as { values: string[] }).values.push('huge')
    expect(engineDescriptorNarrowingErrorsV2(descriptor, widenEnum)).not.toEqual([])

    const moreAdapters = clone(descriptor)
    moreAdapters.operations[0]!.adapters = { families: ['wavecraft-lora-v1'], maxActive: 4 }
    expect(engineDescriptorNarrowingErrorsV2(descriptor, moreAdapters)).not.toEqual([])

    const claimCancel = clone(descriptor)
    claimCancel.operations[1]!.cancellation = true
    expect(engineDescriptorNarrowingErrorsV2(descriptor, claimCancel)).not.toEqual([])

    const claimSeed = clone(descriptor)
    claimSeed.operations[1]!.seed = 'uint32'
    expect(engineDescriptorNarrowingErrorsV2(descriptor, claimSeed)).not.toEqual([])
  })
})

describe('parseEngineRecipeV2 + engineRecipeErrorsV2', () => {
  it('accepts a conforming recipe', () => {
    const parsed = parseEngineRecipeV2(clone(recipe))
    expect(parsed.ok).toBe(true)
    expect(engineRecipeErrorsV2(recipe, descriptor)).toEqual([])
  })

  it('rejects structural garbage', () => {
    expect(parseEngineRecipeV2(null).ok).toBe(false)
    const pathSmuggle = clone(recipe) as unknown as Record<string, unknown>
    pathSmuggle.sourcePath = 'C:/Users/jack/track.wav'
    expect(parseEngineRecipeV2(pathSmuggle).ok).toBe(false)
    const badHash = { ...clone(recipe), descriptorHash: 'nope' }
    expect(parseEngineRecipeV2(badHash).ok).toBe(false)
    const hugePrompt = { ...clone(recipe), prompt: 'x'.repeat(64 * 1024) }
    expect(parseEngineRecipeV2(hugePrompt).ok).toBe(false)
  })

  it('rejects descriptor violations', () => {
    expect(
      engineRecipeErrorsV2({ ...recipe, advanced: { texture: 5 } }, descriptor).join('\n')
    ).toContain('texture')
    expect(
      engineRecipeErrorsV2({ ...recipe, advanced: { warp: true } }, descriptor).join('\n')
    ).toContain('does not declare')
    expect(
      engineRecipeErrorsV2({ ...recipe, common: { timeSignature: '3' } }, descriptor).join('\n')
    ).toContain('does not honor')
    expect(
      engineRecipeErrorsV2({ ...recipe, profileId: 'studio-xl' }, descriptor).join('\n')
    ).toContain('profileId')
    expect(
      engineRecipeErrorsV2(
        { ...recipe, adapters: [1, 2, 3].map((n) => ({ libraryId: `a${n}`, scale: 1 })) },
        descriptor
      ).join('\n')
    ).toContain('at most 2')
    const extend: EngineRecipeV2 = {
      protocolVersion: 2,
      operation: 'music.extend',
      providerId: 'mx.iblis.engine.fixture',
      pluginVersion: '1.0.0',
      descriptorHash: 'a'.repeat(64),
      profileId: 'fast-draft',
      inputs: [],
      seed: 99
    }
    const problems = engineRecipeErrorsV2(extend, descriptor).join('\n')
    expect(problems).toContain('missing required source input')
    expect(problems).toContain('no seed semantics')
  })
})

describe('parseEngineJobStateV2', () => {
  const base = { protocolVersion: 2, jobId: 'job-1', status: 'running', progress: 0.4 }

  it('accepts normalized states and descriptor phases', () => {
    expect(parseEngineJobStateV2({ ...base, phase: 'compose' }, descriptor).ok).toBe(true)
    expect(
      parseEngineJobStateV2(
        {
          protocolVersion: 2,
          jobId: 'job-1',
          status: 'error',
          progress: 0.4,
          error: { code: 'oom', message: 'out of memory' }
        },
        descriptor
      ).ok
    ).toBe(true)
  })

  it('rejects undeclared phases, bad progress, and misplaced fields', () => {
    expect(parseEngineJobStateV2({ ...base, phase: 'exfiltrate' }, descriptor).ok).toBe(false)
    expect(parseEngineJobStateV2({ ...base, progress: Number.NaN }, descriptor).ok).toBe(false)
    expect(parseEngineJobStateV2({ ...base, progress: 1.5 }, descriptor).ok).toBe(false)
    expect(parseEngineJobStateV2({ ...base, status: 'done', progress: 0.9 }, descriptor).ok).toBe(
      false
    )
    expect(
      parseEngineJobStateV2(
        { ...base, error: { code: 'x', message: 'not failed though' } },
        descriptor
      ).ok
    ).toBe(false)
    expect(parseEngineJobStateV2({ ...base, status: 'melting' }, descriptor).ok).toBe(false)
  })
})

describe('parseEngineJobOutputsV2 + engineOutputPathErrorsV2', () => {
  it('accepts declared roles inside the staging directory', () => {
    expect(
      parseEngineJobOutputsV2(
        [
          { role: 'mix', path: 'out/mix.wav' },
          { role: 'preview', path: 'out/preview.wav' }
        ],
        generateOp
      ).ok
    ).toBe(true)
  })

  it('rejects traversal, absolute, and platform-trick paths', () => {
    for (const path of [
      '../outside.wav',
      'out/../../escape.wav',
      '/etc/passwd',
      'C:/windows/system32',
      'out\\mix.wav',
      'out//mix.wav',
      'out/./mix.wav',
      'mix.wav:alternate',
      'a'.repeat(600)
    ]) {
      expect(engineOutputPathErrorsV2(path), path).not.toEqual([])
    }
  })

  it('rejects undeclared roles and overflowing counts', () => {
    expect(parseEngineJobOutputsV2([{ role: 'vocals', path: 'out/v.wav' }], generateOp).ok).toBe(
      false
    )
    expect(
      parseEngineJobOutputsV2(
        [
          { role: 'mix', path: 'a.wav' },
          { role: 'mix', path: 'b.wav' }
        ],
        generateOp
      ).ok
    ).toBe(false)
    expect(
      parseEngineJobOutputsV2(
        [
          { role: 'mix', path: 'a.wav' },
          { role: 'preview', path: 'a.wav' }
        ],
        generateOp
      ).ok
    ).toBe(false)
    expect(parseEngineJobOutputsV2([], generateOp).ok).toBe(false)
  })
})
