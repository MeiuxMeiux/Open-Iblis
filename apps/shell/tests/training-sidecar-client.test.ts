// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import {
  createTrainingSidecarClient,
  TrainingStageCancelled
} from '../electron/main/training/sidecar-client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('training sidecar client', () => {
  it('starts a stage, polls progress, and returns the final result', async () => {
    const calls: { path: string; body?: unknown }[] = []
    const polls = [
      { state: 'running', percent: 25, detail: 'stems 1/4' },
      { state: 'running', percent: 75, detail: 'stems 3/4' },
      { state: 'done', result: { trackCount: 4 } }
    ]
    const client = createTrainingSidecarClient(
      {
        async request(path, init) {
          calls.push({
            path,
            body: init?.body ? (JSON.parse(init.body as string) as unknown) : undefined
          })
          if (path === '/job' && init?.method === 'POST') return jsonResponse({ ok: true })
          return jsonResponse(polls.shift() ?? { state: 'done' })
        }
      },
      async () => {}
    )
    const seen: string[] = []
    const result = await client.runStage(
      'scan',
      'tj-1:scan',
      { source: '/songs' },
      { onProgress: (percent, detail) => seen.push(`${percent} ${detail}`) }
    )
    expect(result).toEqual({ trackCount: 4 })
    expect(seen).toEqual(['25 stems 1/4', '75 stems 3/4'])
    expect(calls[0]).toEqual({
      path: '/job',
      body: { stage: 'scan', jobId: 'tj-1:scan', params: { source: '/songs' } }
    })
  })

  it('surfaces a busy refusal and a failed stage with their messages', async () => {
    const busy = createTrainingSidecarClient(
      { request: async () => jsonResponse({ error: 'busy' }, 409) },
      async () => {}
    )
    await expect(busy.runStage('scan', 'x', {})).rejects.toThrow('busy')

    let started = false
    const failing = createTrainingSidecarClient(
      {
        async request(_path, init) {
          if (init?.method === 'POST' && !started) {
            started = true
            return jsonResponse({ ok: true })
          }
          return jsonResponse({
            state: 'error',
            error: { code: 'trainer_oom', message: 'CUDA out of memory' }
          })
        }
      },
      async () => {}
    )
    await expect(failing.runStage('train-texture', 'x', {})).rejects.toThrow('CUDA out of memory')
  })

  it('sends the cancel verb once the signal flips and reports cancellation', async () => {
    const paths: string[] = []
    const signal = { cancelled: false }
    const client = createTrainingSidecarClient(
      {
        async request(path, init) {
          paths.push(path)
          if (path === '/job' && init?.method === 'POST') return jsonResponse({ ok: true })
          if (path.includes('cancel=1')) return jsonResponse({ ok: true })
          return jsonResponse(
            signal.cancelled ? { state: 'cancelled' } : { state: 'running', percent: 1 }
          )
        }
      },
      async () => {
        signal.cancelled ||= paths.length > 2
      }
    )
    await expect(client.runStage('stems', 'tj-9:stems', {}, { signal })).rejects.toThrow(
      TrainingStageCancelled
    )
    expect(
      paths.some((path) => path.includes('id=tj-9%3Astems') && path.includes('cancel=1'))
    ).toBe(true)
  })
})
