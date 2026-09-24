// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import { parseEngineProps } from '../electron/main/engine/drivers/ace-compat/props'
import {
  canonicalRequestError,
  generationRequestError,
  resolveGenerationRequest
} from '../electron/main/engine/drivers/ace-compat/request'

const RAW_PROPS = {
  version: '948b929',
  models: {
    lm: ['lm-small.gguf', 'lm-large.gguf'],
    embedding: ['embedding.gguf'],
    dit: [
      'acestep-v15-turbo-Q8_0.gguf',
      'acestep-v15-sft-Q8_0.gguf',
      'acestep-v15-xl-turbo-Q4_K_M.gguf'
    ],
    vae: ['vae.gguf']
  },
  adapters: ['studio-lora'],
  default: {
    lm_model: 'lm-small.gguf',
    synth_model: 'acestep-v15-turbo-Q8_0.gguf',
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
const PROPS = parseEngineProps(RAW_PROPS)
const DRAFT: GenerateRequest = {
  prompt: '  warehouse techno  ',
  durationSec: 30,
  preset: 'turbo-validated'
}

describe('canonical generation request resolution', () => {
  it('materializes synthesis and LM uint32 seeds independently once', () => {
    const values = [123, 456]
    const random = vi.fn(() => values.shift()!)
    const resolved = resolveGenerationRequest(DRAFT, PROPS, random)
    expect(random).toHaveBeenCalledTimes(2)
    expect(resolved).toEqual({
      prompt: 'warehouse techno',
      durationSec: 30,
      seed: 123,
      preset: 'turbo-validated',
      config: {
        steps: 8,
        guidance: 1,
        solver: 'euler',
        temperature: 0.85,
        rewritePrompt: true,
        autoLyrics: false,
        lmModel: 'lm-small.gguf',
        synthModel: 'acestep-v15-turbo-Q8_0.gguf',
        shift: 3,
        adapterScale: 1,
        lmSeed: 456
      }
    })
    expect(canonicalRequestError(resolved)).toBeNull()
  })

  it('preserves explicit independent seeds and validates installed selections', () => {
    const random = vi.fn(() => 999)
    const resolved = resolveGenerationRequest(
      {
        ...DRAFT,
        seed: 0xffff_ffff,
        config: {
          lmSeed: 0,
          lmModel: 'lm-large.gguf',
          adapter: 'studio-lora',
          adapterScale: 0.5
        }
      },
      PROPS,
      random
    )
    expect(random).not.toHaveBeenCalled()
    expect(resolved.config).toMatchObject({
      lmSeed: 0,
      lmModel: 'lm-large.gguf',
      adapter: 'studio-lora',
      adapterScale: 0.5
    })
    expect(() =>
      resolveGenerationRequest({ ...DRAFT, config: { lmModel: 'missing.gguf' } }, PROPS)
    ).toThrow('not installed')
    expect(() =>
      resolveGenerationRequest({ ...DRAFT, config: { adapter: 'missing' } }, PROPS)
    ).toThrow('not installed')
    expect(() =>
      resolveGenerationRequest(
        { ...DRAFT, config: { synthModel: 'acestep-v15-sft-Q8_0.gguf' } },
        PROPS
      )
    ).toThrow('requires synthesis model')
    expect(() =>
      resolveGenerationRequest({ ...DRAFT, config: { timeSignature: '4/4' } }, PROPS)
    ).toThrow('beats per bar')
  })

  it('locks the validated tuple while bounding expert controls', () => {
    expect(() => resolveGenerationRequest({ ...DRAFT, config: { steps: 9 } }, PROPS)).toThrow('8–8')
    expect(() => resolveGenerationRequest({ ...DRAFT, config: { guidance: 7 } }, PROPS)).toThrow(
      '1–1'
    )
    expect(() => resolveGenerationRequest({ ...DRAFT, config: { shift: 1 } }, PROPS)).toThrow(
      'shift is locked'
    )

    const expert = resolveGenerationRequest(
      { ...DRAFT, preset: 'turbo-expert', config: { steps: 20, shift: 4, solver: 'dpm3m' } },
      PROPS,
      () => 1
    )
    expect(expert.config?.steps).toBe(20)
    expect(expert.config?.shift).toBe(4)
    expect(expert.config?.solver).toBe('dpm3m')
    expect(
      resolveGenerationRequest(
        { ...DRAFT, preset: 'turbo-expert', config: { shift: 0 } },
        PROPS,
        () => 1
      ).config?.shift
    ).toBe(3)
    const sft = resolveGenerationRequest(
      { ...DRAFT, preset: 'sft-experiment', config: { guidance: 5 } },
      PROPS,
      () => 2
    )
    expect(sft).toMatchObject({
      preset: 'sft-experiment',
      config: {
        synthModel: 'acestep-v15-sft-Q8_0.gguf',
        steps: 50,
        guidance: 5,
        shift: 1,
        solver: 'euler'
      }
    })
    const xl = resolveGenerationRequest(
      { ...DRAFT, preset: 'xl-turbo-experiment', config: { solver: 'sde' } },
      PROPS,
      () => 3
    )
    expect(xl).toMatchObject({
      preset: 'xl-turbo-experiment',
      config: {
        synthModel: 'acestep-v15-xl-turbo-Q4_K_M.gguf',
        steps: 8,
        guidance: 1,
        shift: 3,
        solver: 'sde'
      }
    })
    expect(canonicalRequestError(xl)).toBeNull()
    expect(canonicalRequestError({ ...xl, config: { ...xl.config, steps: 9 } })).toContain(
      'canonically'
    )
    expect(() =>
      resolveGenerationRequest(
        { ...DRAFT, preset: 'xl-turbo-experiment', config: { steps: 9 } },
        PROPS
      )
    ).toThrow('8–8')
    expect(() =>
      resolveGenerationRequest(
        {
          ...DRAFT,
          preset: 'xl-turbo-experiment',
          config: { synthModel: 'acestep-v15-turbo-Q8_0.gguf' }
        },
        PROPS
      )
    ).toThrow('requires synthesis model')
    expect(() =>
      resolveGenerationRequest({ ...DRAFT, preset: 'turbo-expert', config: { steps: 21 } }, PROPS)
    ).toThrow('1–20')
    expect(
      generationRequestError({ ...DRAFT, preset: 'turbo-expert', config: { shift: 21 } })
    ).toContain('invalid')
  })

  it('rejects malformed persisted fields and unresolved requests', () => {
    expect(generationRequestError({ ...DRAFT, seed: -1 })).toContain('invalid')
    expect(generationRequestError({ ...DRAFT, seed: 1.5 })).toContain('invalid')
    expect(generationRequestError({ ...DRAFT, config: { lmSeed: 0x1_0000_0000 } })).toContain(
      'invalid'
    )
    expect(generationRequestError({ ...DRAFT, config: { steps: 8, surprise: true } })).toContain(
      'unknown'
    )
    expect(canonicalRequestError(DRAFT)).toContain('seeds')
    expect(
      canonicalRequestError({
        ...DRAFT,
        preset: 'turbo-expert',
        seed: 1,
        config: {
          steps: 8,
          guidance: 1,
          temperature: 0.85,
          rewritePrompt: true,
          autoLyrics: false,
          lmModel: 'lm-small.gguf',
          synthModel: 'acestep-v15-turbo-Q8_0.gguf',
          adapterScale: 1,
          lmSeed: 2
        }
      })
    ).toContain('canonically')
  })
})
