// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import {
  MAX_ENGINE_PROPS_BYTES,
  parseEngineProps,
  profilesFromProps,
  readEngineProps,
  runtimeFromProps
} from '../electron/main/engine/drivers/ace-compat/props'

function rawProps(): Record<string, unknown> {
  return {
    version: '948b929',
    models: {
      lm: ['acestep-5Hz-lm-1.7B-Q8_0.gguf'],
      embedding: ['Qwen3-Embedding-0.6B-Q8_0.gguf'],
      dit: ['acestep-v15-turbo-Q8_0.gguf'],
      vae: ['vae-BF16.gguf']
    },
    adapters: [],
    default: {
      lm_model: '',
      synth_model: '',
      lm_temperature: 0.85,
      solver: 'euler',
      timesignature: '',
      use_cot_caption: true,
      adapter: '',
      adapter_scale: 1
    },
    presets: {
      turbo: { inference_steps: 8, guidance_scale: 1, shift: 3 },
      sft: { inference_steps: 50, guidance_scale: 1, shift: 1 }
    }
  }
}

describe('engine /props validation', () => {
  it('projects bounded runtime facts and exact turbo profiles', () => {
    const props = parseEngineProps(rawProps())
    expect(runtimeFromProps(props)).toEqual({
      version: '948b929',
      lmModels: ['acestep-5Hz-lm-1.7B-Q8_0.gguf'],
      synthModels: ['acestep-v15-turbo-Q8_0.gguf'],
      adapters: [],
      solvers: ['euler', 'sde', 'dpm3m', 'stork4'],
      defaultLmModel: 'acestep-5Hz-lm-1.7B-Q8_0.gguf',
      defaultSynthModel: 'acestep-v15-turbo-Q8_0.gguf',
      defaultTemperature: 0.85
    })
    expect(profilesFromProps(props)).toEqual([
      expect.objectContaining({
        id: 'turbo-validated',
        kind: 'validated',
        steps: { default: 8, min: 8, max: 8 },
        guidance: { default: 1, min: 1, max: 1 },
        shift: 3,
        solver: 'euler'
      }),
      expect.objectContaining({
        id: 'turbo-expert',
        kind: 'expert',
        steps: { default: 8, min: 1, max: 20 },
        guidance: { default: 1, min: 1, max: 1 }
      })
    ])
  })

  it('labels an installed exact SFT tuple as an experiment, never Quality', () => {
    const raw = rawProps()
    ;(raw.models as Record<string, unknown>).dit = ['acestep-v15-sft-Q8_0.gguf']
    const profiles = profilesFromProps(parseEngineProps(raw))
    expect(profiles).toEqual([
      expect.objectContaining({
        id: 'sft-experiment',
        name: expect.stringContaining('experiment') as string,
        synthModel: 'acestep-v15-sft-Q8_0.gguf',
        steps: { default: 50, min: 50, max: 50 },
        guidance: { default: 1, min: 1, max: 7 }
      })
    ])
    expect(profiles[0]?.name).not.toContain('Quality')
  })

  it('keeps the 2B turbo validated and exposes an XL turbo as a fixed-step experiment', () => {
    const raw = rawProps()
    ;(raw.models as Record<string, unknown>).dit = [
      'acestep-v15-xl-turbo-Q4_K_M.gguf',
      'acestep-v15-turbo-Q8_0.gguf'
    ]
    const profiles = profilesFromProps(parseEngineProps(raw))
    expect(profiles.map((profile) => profile.id)).toEqual([
      'turbo-validated',
      'turbo-expert',
      'xl-turbo-experiment'
    ])
    expect(profiles[0]?.synthModel).toBe('acestep-v15-turbo-Q8_0.gguf')
    expect(profiles[2]).toMatchObject({
      kind: 'expert',
      synthModel: 'acestep-v15-xl-turbo-Q4_K_M.gguf',
      steps: { default: 8, min: 8, max: 8 },
      guidance: { default: 1, min: 1, max: 1 },
      shift: 3,
      solver: 'euler'
    })
    expect(profiles[2]?.name).toContain('experiment')
    expect(profiles[2]?.name).not.toContain('Quality')

    const xlOnly = rawProps()
    ;(xlOnly.models as Record<string, unknown>).dit = ['acestep-v15-xl-turbo-Q4_K_M.gguf']
    expect(profilesFromProps(parseEngineProps(xlOnly)).map((profile) => profile.id)).toEqual([
      'xl-turbo-experiment'
    ])

    const xlSft = rawProps()
    ;(xlSft.models as Record<string, unknown>).dit = ['acestep-v15-xl-sft-Q4_K_M.gguf']
    expect(profilesFromProps(parseEngineProps(xlSft))).toEqual([])
  })

  it('withholds profiles unless the upstream turbo tuple and euler default are exact', () => {
    for (const mutate of [
      (raw: Record<string, unknown>) =>
        ((
          (raw.presets as Record<string, unknown>).turbo as Record<string, unknown>
        ).inference_steps = 32),
      (raw: Record<string, unknown>) =>
        ((
          (raw.presets as Record<string, unknown>).turbo as Record<string, unknown>
        ).guidance_scale = 7),
      (raw: Record<string, unknown>) => ((raw.default as Record<string, unknown>).solver = 'sde')
    ]) {
      const raw = rawProps()
      mutate(raw)
      expect(profilesFromProps(parseEngineProps(raw))).toEqual([])
    }
  })

  it('fails closed on duplicate names and defaults outside installed registries', () => {
    const duplicate = rawProps()
    ;(duplicate.models as Record<string, unknown>).lm = ['same.gguf', 'same.gguf']
    expect(() => parseEngineProps(duplicate)).toThrow('duplicates')

    const missing = rawProps()
    ;(missing.default as Record<string, unknown>).synth_model = 'missing.gguf'
    expect(() => parseEngineProps(missing)).toThrow('not installed')

    const invalidSignature = rawProps()
    ;(invalidSignature.default as Record<string, unknown>).timesignature = '4/4'
    expect(() => parseEngineProps(invalidSignature)).toThrow('timesignature')
  })

  it('reads a JSON response and rejects non-JSON or oversized bodies', async () => {
    const valid = new Response(JSON.stringify(rawProps()), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    })
    await expect(readEngineProps(valid)).resolves.toMatchObject({ version: '948b929' })
    await expect(readEngineProps(new Response('{}'))).rejects.toThrow('did not return JSON')
    await expect(
      readEngineProps(
        new Response('x'.repeat(MAX_ENGINE_PROPS_BYTES + 1), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    ).rejects.toThrow('too large')
  })
})
