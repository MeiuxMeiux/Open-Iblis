// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import {
  MAX_COMPARISON_BLUEPRINT_BYTES,
  carveWav,
  lmBody,
  synthBody,
  validComparisonBlueprint
} from '../electron/main/engine/drivers/ace-compat/protocol'
import { parseWav } from '../electron/main/media/wav'
import { makeWav, multipartWav } from './fixtures/wav'

const REQ: GenerateRequest = {
  prompt: 'calm lo-fi piano',
  durationSec: 10,
  preset: 'turbo-validated',
  seed: 42,
  config: { steps: 8 }
}

describe('engine protocol primitives', () => {
  it('lmBody carries prompt as caption, seed when set, and duration when > 0', () => {
    expect(lmBody(REQ)).toEqual({
      caption: 'calm lo-fi piano',
      lm_mode: 'generate',
      lyrics: '[Instrumental]',
      seed: 42,
      duration: 10,
      inference_steps: 8
    })
    const { seed, ...noSeed } = REQ
    void seed
    expect(lmBody(noSeed).seed).toBeUndefined()
    expect(lmBody({ ...REQ, durationSec: 0 }).duration).toBeUndefined()
  })

  it('defaults to instrumental but passes explicit lyrics through', () => {
    expect(lmBody(REQ).lyrics).toBe('[Instrumental]')
    expect(lmBody({ ...REQ, lyrics: '  ' }).lyrics).toBe('[Instrumental]')
    expect(lmBody({ ...REQ, lyrics: 'my words' }).lyrics).toBe('my words')
  })

  it('omits lyrics when autoLyrics opts into engine-written vocals', () => {
    const body = lmBody({ ...REQ, config: { autoLyrics: true } })
    expect('lyrics' in body).toBe(false)
    expect(lmBody({ ...REQ, lyrics: 'mine', config: { autoLyrics: true } }).lyrics).toBe('mine')
  })

  it('maps only resolved config steps and never invents them from a profile label', () => {
    expect(lmBody(REQ).inference_steps).toBe(8)
    expect(lmBody({ ...REQ, preset: 'quality', config: undefined }).inference_steps).toBeUndefined()
    expect(lmBody({ ...REQ, config: { steps: 20 } }).inference_steps).toBe(20)
  })

  it('passes steering knobs through in ace-server dialect', () => {
    const body = lmBody({
      ...REQ,
      config: {
        negativePrompt: ' pop, cheerful ',
        bpm: 174,
        keyscale: 'F minor',
        guidance: 7.5,
        solver: 'sde',
        temperature: 0.85,
        rewritePrompt: false
      }
    })
    expect(body.lm_negative_prompt).toBe('pop, cheerful')
    expect(body.bpm).toBe(174)
    expect(body.keyscale).toBe('F minor')
    expect(body.guidance_scale).toBe(7.5)
    expect(body.solver).toBe('sde')
    expect(body.lm_temperature).toBe(0.85)
    expect(body.use_cot_caption).toBe(false)
  })

  it('drops empty strings and maps explicit numeric and boolean controls exactly', () => {
    const body = lmBody({
      ...REQ,
      config: { negativePrompt: '  ', bpm: 0, keyscale: '', guidance: 0, rewritePrompt: true }
    })
    for (const key of ['lm_negative_prompt', 'bpm', 'keyscale', 'solver', 'lm_temperature']) {
      expect(body[key]).toBeUndefined()
    }
    expect(body.guidance_scale).toBe(0)
    expect(body.use_cot_caption).toBe(true)
  })

  it('maps model, adapter, signature, shift, and independent LM seed keys', () => {
    const body = lmBody({
      ...REQ,
      config: {
        steps: 8,
        lmSeed: 99,
        lmModel: 'acestep-lm.gguf',
        synthModel: 'acestep-turbo.gguf',
        timeSignature: '3',
        shift: 3,
        adapter: 'studio-lora',
        adapterScale: 0.75
      }
    })
    expect(body.seed).toBe(42)
    expect(body.lm_seed).toBe(99)
    expect(body.lm_model).toBe('acestep-lm.gguf')
    expect(body.synth_model).toBe('acestep-turbo.gguf')
    expect(body.timesignature).toBe('3')
    expect(body.shift).toBe(3)
    expect(body.adapter).toBe('studio-lora')
    expect(body.adapter_scale).toBe(0.75)
  })

  it('synthBody wraps an object, preserves an array, and stamps output_format', () => {
    expect(synthBody('{"a":1}')).toEqual([{ a: 1, output_format: 'wav32' }])
    expect(synthBody('[{"a":1},{"b":2}]', 'mp3')).toEqual([
      { a: 1, output_format: 'mp3' },
      { b: 2, output_format: 'mp3' }
    ])
  })

  it('bounds comparison blueprints and requires saved audio codes', () => {
    expect(validComparisonBlueprint('[{"audio_codes":"1,2,3"}]')).toBe(true)
    expect(validComparisonBlueprint('[{"caption":"no codes"}]')).toBe(false)
    expect(validComparisonBlueprint('{bad')).toBe(false)
    expect(
      validComparisonBlueprint(
        JSON.stringify([{ audio_codes: 'x'.repeat(MAX_COMPARISON_BLUEPRINT_BYTES) }])
      )
    ).toBe(false)
  })

  it('overrides only candidate synthesis controls on a saved LM blueprint', () => {
    const result = synthBody(
      '[{"audio_codes":"same","caption":"same","lm_seed":4,"synth_model":"turbo.gguf"}]',
      'wav32',
      {
        ...REQ,
        preset: 'sft-experiment',
        config: {
          steps: 50,
          guidance: 5,
          shift: 1,
          solver: 'euler',
          synthModel: 'sft.gguf'
        }
      }
    )
    expect(result).toEqual([
      {
        audio_codes: 'same',
        caption: 'same',
        lm_seed: 4,
        seed: 42,
        inference_steps: 50,
        guidance_scale: 5,
        shift: 1,
        solver: 'euler',
        synth_model: 'sft.gguf',
        output_format: 'wav32'
      }
    ])
  })

  it('carves exactly the audio/wav part from a multipart body', () => {
    const wav = makeWav({ data: Buffer.from('the-real-bytes') })
    const carved = carveWav(multipartWav(wav))
    expect(carved.bytes.equals(wav)).toBe(true)
    expect(carved.metadata).toEqual(parseWav(wav))
  })

  it('falls back to the RIFF length when no typed part is present', () => {
    const wav = makeWav({ frames: 8 })
    const body = Buffer.concat([
      Buffer.from('--ace-batch-boundary\r\n\r\n'),
      wav,
      Buffer.from('\r\n--ace-batch-boundary--')
    ])
    expect(carveWav(body).bytes.equals(wav)).toBe(true)
  })
})
