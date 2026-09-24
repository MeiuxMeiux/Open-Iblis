// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import { createEngineClient } from '../electron/main/engine/drivers/ace-compat/client'
import type { EngineGenerationEvidence } from '../electron/main/engine/drivers/ace-compat/evidence'
import { parseWav } from '../electron/main/media/wav'
import { makeWav, multipartWav } from './fixtures/wav'

// Drives the host engine client against a mock that speaks the real ace-server
// dialect (two-phase /lm + /synth, 404-until-done on /job?...&result=1, a
// multipart/mixed synth body) — proving the bridge reaches the clean contract's
// `done` with a carved WAV, and maps terminal/timeout failures to JobError.

const REQ: GenerateRequest = {
  prompt: 'calm lo-fi piano',
  durationSec: 10,
  preset: 'turbo-validated',
  seed: 42,
  config: { steps: 8 }
}

function jsonRes(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status })
}

interface MockOpts {
  lmPolls?: number
  synthPolls?: number
  synthBody?: Buffer
  failSynth?: boolean
}

// A scripted ace-server: result=1 returns 404 until the Nth poll, then 200.
function mockFetch(opts: MockOpts) {
  const lmNeeded = opts.lmPolls ?? 1
  const synthNeeded = opts.synthPolls ?? 1
  let lmCalls = 0
  let synthCalls = 0
  return async (path: string, init?: RequestInit): Promise<Response> => {
    if (path === '/lm' && init?.method === 'POST') return jsonRes({ id: 'lm1' })
    if (path === '/synth' && init?.method === 'POST') return jsonRes({ id: 'synth1' })

    if (path.startsWith('/job?id=lm1&result=1')) {
      lmCalls++
      return lmCalls >= lmNeeded
        ? new Response('[{"foo":1}]', { status: 200 })
        : new Response('nr', { status: 404 })
    }
    if (path.startsWith('/job?id=synth1&result=1')) {
      synthCalls++
      if (opts.failSynth) return new Response('nr', { status: 404 })
      return synthCalls >= synthNeeded
        ? new Response(opts.synthBody, { status: 200 })
        : new Response('nr', { status: 404 })
    }
    if (path === '/job?id=lm1') return jsonRes({ status: lmCalls >= lmNeeded ? 'done' : 'running' })
    if (path === '/job?id=synth1') {
      return jsonRes({
        status: opts.failSynth ? 'failed' : synthCalls >= synthNeeded ? 'done' : 'running'
      })
    }
    return new Response('not found', { status: 404 })
  }
}

// Wrap a mock fetch, recording every request as "METHOD path" so cancel tests
// can assert exactly which engine endpoints were (or were not) hit.
function loggedFetch(
  inner: (path: string, init?: RequestInit) => Promise<Response>,
  calls: string[]
): (path: string, init?: RequestInit) => Promise<Response> {
  return (path, init) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    return inner(path, init)
  }
}

async function waitFor(pred: () => boolean, tries = 2000): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error('timed out waiting for job to settle')
}

describe('engine client state machine', () => {
  it('drives lm -> synth -> carved WAV to done', async () => {
    const written: Record<string, Buffer> = {}
    const metadata: Record<string, ReturnType<typeof parseWav>> = {}
    let evidence: EngineGenerationEvidence | undefined
    const client = createEngineClient({
      fetch: mockFetch({
        lmPolls: 2,
        synthPolls: 3,
        synthBody: multipartWav(makeWav({ data: Buffer.from('xyz') }))
      }),
      writeWav: async (id, bytes, _req, facts) => {
        written[id] = bytes
        metadata[id] = facts
        return { trackId: id }
      },
      writeEvidence: async (_trackId, captured) => {
        evidence = captured
      },
      sleep: async () => {},
      pollIntervalMs: 0
    })

    const { jobId } = client.generate(REQ, { id: 'engine-a', version: '0.1.4' })
    expect(client.jobState(jobId)?.status).toBe('queued')

    await waitFor(() => client.jobState(jobId)?.status === 'done')
    const st = client.jobState(jobId)!
    expect(st.progress).toBe(1)
    expect(st.result).toEqual({ trackId: jobId, format: 'wav' })
    expect(parseWav(written[jobId]!)).toMatchObject({ codec: 'pcm', frames: 3 })
    expect(metadata[jobId]).toEqual(parseWav(written[jobId]!))
    expect(evidence?.request).toEqual(REQ)
    expect(evidence?.engine).toEqual({ id: 'engine-a', version: '0.1.4' })
    expect(evidence?.effectiveRequest.inference_steps).toBe(8)
    expect(evidence?.phases.map((phase) => [phase.phase, phase.engineJobId])).toEqual([
      ['lm', 'lm1'],
      ['synth', 'synth1'],
      ['finishing', undefined]
    ])
  })

  it('rejects malformed synth audio before the writer is called', async () => {
    const wav = makeWav({ frames: 8 })
    wav.writeUInt32LE(wav.readUInt32LE(4) + 100, 4)
    let writes = 0
    const client = createEngineClient({
      fetch: mockFetch({ synthBody: multipartWav(wav) }),
      writeWav: async () => {
        writes++
        return { trackId: 'never' }
      },
      sleep: async () => {},
      pollIntervalMs: 0
    })

    const { jobId } = client.generate(REQ)
    await waitFor(() => client.jobState(jobId)?.status === 'error')
    expect(client.jobState(jobId)?.error?.code).toBe('bad_wav')
    expect(writes).toBe(0)
  })

  it('maps a FAILED synth job to a job_failed error', async () => {
    const client = createEngineClient({
      fetch: mockFetch({ failSynth: true }),
      writeWav: async () => ({ trackId: 'never' }),
      sleep: async () => {},
      pollIntervalMs: 0
    })
    const { jobId } = client.generate(REQ)
    await waitFor(() => client.jobState(jobId)?.status === 'error')
    expect(client.jobState(jobId)?.error?.code).toBe('job_failed')
  })

  it('cancel mid-lm POSTs the engine cancel and settles as job_cancelled', async () => {
    const calls: string[] = []
    const client = createEngineClient({
      fetch: loggedFetch(mockFetch({ lmPolls: 9999 }), calls),
      writeWav: async () => ({ trackId: 'never' }),
      // A real macrotask yield (NOT a resolved-promise stub): this poll loop
      // runs unbounded until the cancel below, and a microtask-only loop would
      // starve waitFor's setTimeout forever and OOM the worker.
      sleep: () => new Promise((r) => setTimeout(r, 0)),
      pollIntervalMs: 0
    })
    const { jobId } = client.generate(REQ)
    // Let the chain actually reach the lm poll loop so the engine-side id is
    // registered — this exercises the "cancel targets the in-flight phase" path.
    await waitFor(() => calls.some((c) => c.startsWith('GET /job?id=lm1&result=1')))

    expect(await client.cancel(jobId)).toBe(true)
    await waitFor(() => client.jobState(jobId)?.status === 'error')
    expect(client.jobState(jobId)?.error?.code).toBe('job_cancelled')
    expect(calls).toContain('POST /job?id=lm1&cancel=1')
    // The chain must stop cold: no /synth phase after a cancel.
    expect(calls.some((c) => c.startsWith('POST /synth'))).toBe(false)
  })

  it('cancel while still queued stops the chain before any engine POST', async () => {
    const calls: string[] = []
    const client = createEngineClient({
      fetch: loggedFetch(mockFetch({}), calls),
      writeWav: async () => ({ trackId: 'never' }),
      sleep: async () => {},
      pollIntervalMs: 0
    })
    const { jobId } = client.generate(REQ)
    // Same tick as generate(): drive() has not started yet (it is queued behind
    // a microtask), so the cancel must be caught by the flag alone.
    expect(await client.cancel(jobId)).toBe(true)

    await waitFor(() => client.jobState(jobId)?.status === 'error')
    expect(client.jobState(jobId)?.error?.code).toBe('job_cancelled')
    expect(calls.some((c) => c.startsWith('POST /lm'))).toBe(false)
  })

  it('bounds upstream cancel and aborts a hung local poll', async () => {
    const calls: string[] = []
    let polling = false
    const client = createEngineClient({
      fetch: (path, init) => {
        calls.push(`${init?.method ?? 'GET'} ${path}`)
        if (path === '/lm') return Promise.resolve(jsonRes({ id: 'lm1' }))
        if (path.includes('result=1')) {
          polling = true
          return new Promise<Response>(() => {})
        }
        if (path.includes('cancel=1')) return new Promise<Response>(() => {})
        return Promise.resolve(jsonRes({ status: 'running' }))
      },
      writeWav: async () => ({ trackId: 'never' }),
      cancelTimeoutMs: 5
    })
    const { jobId } = client.generate(REQ)
    await waitFor(() => polling)

    await expect(client.cancel(jobId)).resolves.toBe(true)
    await expect(client.settled(jobId)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'job_cancelled' }
    })
    expect(calls).toContain('POST /job?id=lm1&cancel=1')
  })

  it('cancels while a response body is stalled', async () => {
    let consuming = false
    const client = createEngineClient({
      fetch: async (path) => {
        if (path !== '/lm') return new Response('not found', { status: 404 })
        consuming = true
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 })
      },
      writeWav: async () => ({ trackId: 'never' })
    })
    const { jobId } = client.generate(REQ)
    await waitFor(() => consuming)

    await expect(client.cancel(jobId)).resolves.toBe(true)
    await expect(client.settled(jobId)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'job_cancelled' }
    })
  })

  it('aborts a live chain with the infrastructure reason intact', async () => {
    const calls: string[] = []
    const client = createEngineClient({
      fetch: loggedFetch(mockFetch({ lmPolls: 9999 }), calls),
      writeWav: async () => ({ trackId: 'never' }),
      sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
      pollIntervalMs: 0
    })
    const { jobId } = client.generate(REQ)
    await waitFor(() => calls.some((call) => call.startsWith('GET /job?id=lm1&result=1')))

    await expect(client.abortActive('sidecar_lost', 'engine sidecar exited')).resolves.toBe(jobId)
    await expect(client.settled(jobId)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'sidecar_lost' }
    })
    expect(calls).toContain('POST /job?id=lm1&cancel=1')
  })

  it('cancel on a finished or unknown job is a no-op returning false', async () => {
    const client = createEngineClient({
      fetch: mockFetch({ synthBody: multipartWav(makeWav({ frames: 8 })) }),
      writeWav: async (id) => ({ trackId: id }),
      sleep: async () => {},
      pollIntervalMs: 0
    })
    const { jobId } = client.generate(REQ)
    await waitFor(() => client.jobState(jobId)?.status === 'done')

    expect(await client.cancel(jobId)).toBe(false)
    expect(client.jobState(jobId)?.status).toBe('done')
    expect(await client.cancel('never-existed')).toBe(false)
  })

  it('rejects concurrency and exposes final settlement after live cleanup', async () => {
    const client = createEngineClient({
      fetch: mockFetch({ lmPolls: 9999 }),
      writeWav: async () => ({ trackId: 'never' }),
      sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
      pollIntervalMs: 0
    })
    const first = client.generate(REQ)
    expect(() => client.generate(REQ)).toThrow('already has an active job')
    await client.cancel(first.jobId)
    await expect(client.settled(first.jobId)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'job_cancelled' }
    })

    const next = client.generate(REQ)
    await client.cancel(next.jobId)
    await client.settled(next.jobId)
  })

  it('times out a job that never produces a result', async () => {
    let t = 0
    const client = createEngineClient({
      fetch: mockFetch({ lmPolls: 9999 }), // never reaches the done threshold
      writeWav: async () => ({ trackId: 'never' }),
      sleep: async () => {},
      pollIntervalMs: 0,
      now: () => (t += 10_000), // each call jumps 10s, blowing past the window
      lmTimeoutMs: 1000
    })
    const { jobId } = client.generate(REQ)
    await waitFor(() => client.jobState(jobId)?.status === 'error')
    expect(client.jobState(jobId)?.error?.code).toBe('timeout')
  })

  it('times out a start request that never returns headers', async () => {
    const client = createEngineClient({
      fetch: () => new Promise<Response>(() => {}),
      writeWav: async () => ({ trackId: 'never' }),
      lmTimeoutMs: 5
    })
    const { jobId } = client.generate(REQ)

    await expect(client.settled(jobId)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'timeout' }
    })
  })
})
