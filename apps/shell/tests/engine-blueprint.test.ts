// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import { createEngineClient } from '../electron/main/engine/drivers/ace-compat/client'
import type { EngineGenerationEvidence } from '../electron/main/engine/drivers/ace-compat/evidence'
import { makeWav, multipartWav } from './fixtures/wav'

const CONTROL: GenerateRequest = {
  prompt: 'same blueprint',
  durationSec: 10,
  preset: 'turbo-validated',
  seed: 42,
  config: { steps: 8 }
}

function jsonRes(value: unknown): Response {
  return new Response(JSON.stringify(value))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 2000; index++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('timed out waiting for engine')
}

describe('engine comparison blueprint reuse', () => {
  it('runs LM once, overrides candidate synthesis, and records the exact submitted recipe', async () => {
    const calls: string[] = []
    const postedSynth: unknown[] = []
    const evidence: EngineGenerationEvidence[] = []
    let synthCount = 0
    const blueprint = JSON.stringify([
      {
        audio_codes: 'same-saved-codes',
        caption: 'same blueprint',
        seed: 42,
        inference_steps: 8,
        guidance_scale: 1,
        shift: 3,
        synth_model: 'turbo.gguf'
      }
    ])
    const client = createEngineClient({
      fetch: async (path, init) => {
        calls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path === '/lm' && init?.method === 'POST') return jsonRes({ id: 'lm1' })
        if (path === '/job?id=lm1&result=1') return new Response(blueprint)
        if (path === '/synth' && init?.method === 'POST') {
          postedSynth.push(JSON.parse(init.body as string))
          return jsonRes({ id: `synth${++synthCount}` })
        }
        if (path.startsWith('/job?id=synth') && path.endsWith('&result=1')) {
          return new Response(multipartWav(makeWav({ frames: 8 })))
        }
        return new Response('not found', { status: 404 })
      },
      writeWav: async (id) => ({ trackId: id }),
      writeEvidence: async (_trackId, value) => {
        evidence.push(value)
      },
      sleep: async () => {},
      pollIntervalMs: 0
    })
    const candidate: GenerateRequest = {
      ...CONTROL,
      preset: 'sft-experiment',
      config: {
        steps: 50,
        guidance: 5,
        shift: 1,
        solver: 'euler',
        synthModel: 'sft.gguf',
        adapterScale: 1
      }
    }

    const first = client.generate(CONTROL)
    await waitFor(() => client.jobState(first.jobId)?.status === 'done')
    const second = client.generate(candidate, undefined, client.blueprint(first.jobId))
    await waitFor(() => client.jobState(second.jobId)?.status === 'done')

    expect(calls.filter((call) => call === 'POST /lm')).toHaveLength(1)
    expect(calls.filter((call) => call === 'POST /synth')).toHaveLength(2)
    expect(postedSynth[1]).toEqual([
      expect.objectContaining({
        audio_codes: 'same-saved-codes',
        caption: 'same blueprint',
        seed: 42,
        inference_steps: 50,
        guidance_scale: 5,
        shift: 1,
        solver: 'euler',
        synth_model: 'sft.gguf',
        output_format: 'wav32'
      })
    ])
    expect(JSON.parse(evidence[1]!.resolvedSynthText)).toEqual(postedSynth[1])
    expect(client.blueprint(second.jobId)).toBe(blueprint)
  })
})
