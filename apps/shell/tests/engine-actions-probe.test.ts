// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROBE_EXTEND_SEC,
  PROBE_SOURCE_SEC,
  multipartFormData,
  probeRequestJson,
  probeSourceWav,
  readActionsEvidence,
  runActionsProbe,
  runActionsProbeWithLease
} from '../electron/main/engine/drivers/ace-compat/actions-probe'
import { parseWav } from '../electron/main/media/wav'
import { makeWav } from './fixtures/wav'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('actions probe source', () => {
  it('synthesizes a valid deterministic source WAV of the declared length', () => {
    const wav = probeSourceWav()
    const facts = parseWav(wav)
    expect(facts.codec).toBe('pcm')
    expect(facts.channels).toBe(2)
    expect(facts.sampleRateHz).toBe(48_000)
    expect(facts.durationSec).toBeCloseTo(PROBE_SOURCE_SEC, 3)
    expect(probeSourceWav().equals(wav)).toBe(true)
  })

  it('asks for a repaint region entirely beyond the source (outpaint after)', () => {
    const req = probeRequestJson()
    expect(req.task_type).toBe('repaint')
    expect(req.repainting_start).toBe(PROBE_SOURCE_SEC)
    expect(req.repainting_end).toBe(PROBE_SOURCE_SEC + PROBE_EXTEND_SEC)
    expect(req.lyrics).toBe('[Instrumental]')
    expect(req.output_format).toBe('wav32')
  })
})

describe('multipart form data', () => {
  it('encodes request and audio parts with the declared boundary', () => {
    const { contentType, body } = multipartFormData(
      [
        { name: 'request', contentType: 'application/json', data: Buffer.from('{"a":1}') },
        { name: 'audio', filename: 'x.wav', contentType: 'audio/wav', data: Buffer.from('RIFF') }
      ],
      'test-boundary'
    )
    expect(contentType).toBe('multipart/form-data; boundary=test-boundary')
    const text = body.toString('latin1')
    expect(text).toContain('--test-boundary\r\nContent-Disposition: form-data; name="request"')
    expect(text).toContain('name="audio"; filename="x.wav"')
    expect(text).toContain('Content-Type: audio/wav')
    expect(text.endsWith('--test-boundary--\r\n')).toBe(true)
  })

  it('keeps binary part bytes intact', () => {
    const data = Buffer.from([0, 255, 13, 10, 45, 45])
    const { body } = multipartFormData(
      [{ name: 'audio', contentType: 'audio/wav', data }],
      'test-boundary'
    )
    expect(body.includes(data)).toBe(true)
  })
})

function multipartMixedWav(durationSec: number): Buffer {
  const wav = makeWav({ frames: Math.round(durationSec * 8000) })
  return Buffer.concat([
    Buffer.from('--ace-batch-boundary\r\nContent-Type: audio/wav\r\n\r\n', 'latin1'),
    wav,
    Buffer.from('\r\n--ace-batch-boundary--\r\n', 'latin1')
  ])
}

function mockServer(resultBody: Buffer): (path: string, init?: RequestInit) => Promise<Response> {
  let polls = 0
  return async (path) => {
    if (path === '/synth') return Response.json({ id: 7 })
    if (path.startsWith('/job?id=7&result=1')) {
      polls += 1
      return polls < 2
        ? new Response(null, { status: 404 })
        : new Response(new Uint8Array(resultBody), { status: 200 })
    }
    if (path.startsWith('/job?id=7')) return Response.json({ status: 'running' })
    throw new Error(`unexpected path ${path}`)
  }
}

describe('runActionsProbe', () => {
  it('passes when the engine returns the extended duration', async () => {
    const evidence = await runActionsProbe({
      fetch: mockServer(multipartMixedWav(PROBE_SOURCE_SEC + PROBE_EXTEND_SEC)),
      engineId: 'mx.iblis.engine.acestep',
      engineVersion: '0.1.4',
      sleep: async () => {},
      persist: async () => {}
    })
    expect(evidence.passed).toBe(true)
    expect(evidence.outputSec).toBeCloseTo(PROBE_SOURCE_SEC + PROBE_EXTEND_SEC, 1)
    expect(evidence.engineVersion).toBe('0.1.4')
    expect(evidence.mediaAvailable).toBe(true)
  })

  it('persists playable source and result WAVs beside durable evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iblis-actions-probe-'))
    roots.push(root)
    vi.stubEnv('IBLIS_DATA_DIR', root)
    const returned = makeWav({ frames: (PROBE_SOURCE_SEC + PROBE_EXTEND_SEC) * 8000 })

    await runActionsProbe({
      fetch: mockServer(multipartMixedWav(PROBE_SOURCE_SEC + PROBE_EXTEND_SEC)),
      engineId: 'mx.iblis.engine.acestep',
      engineVersion: '0.1.4',
      sleep: async () => {}
    })

    expect(
      (await readFile(join(root, 'engine-actions-probe', 'source.wav'))).equals(probeSourceWav())
    ).toBe(true)
    expect(
      (await readFile(join(root, 'engine-actions-probe', 'result.wav'))).equals(returned)
    ).toBe(true)
    await expect(readActionsEvidence()).resolves.toMatchObject({ mediaAvailable: true })
  })

  it('fails honestly when the engine ignores the outpaint region', async () => {
    const evidence = await runActionsProbe({
      fetch: mockServer(multipartMixedWav(PROBE_SOURCE_SEC)),
      engineId: 'mx.iblis.engine.acestep',
      engineVersion: '0.1.4',
      sleep: async () => {},
      persist: async () => {}
    })
    expect(evidence.passed).toBe(false)
    expect(evidence.note).toContain('do not build Extend')
  })

  it('surfaces a terminal engine failure instead of timing out', async () => {
    const fetch = async (path: string): Promise<Response> => {
      if (path === '/synth') return Response.json({ id: 9 })
      if (path.startsWith('/job?id=9&result=1')) return new Response(null, { status: 404 })
      return Response.json({ status: 'failed' })
    }
    await expect(
      runActionsProbe({
        fetch,
        engineId: 'mx.iblis.engine.acestep',
        engineVersion: '0.1.4',
        sleep: async () => {}
      })
    ).rejects.toThrow(/failed/)
  })
})

describe('actions probe engine lease', () => {
  it('holds the empty-queue mutation lease through the complete probe operation', async () => {
    let finishProbe!: (evidence: Awaited<ReturnType<typeof runActionsProbe>>) => void
    const probe = new Promise<Awaited<ReturnType<typeof runActionsProbe>>>((resolve) => {
      finishProbe = resolve
    })
    const release = vi.fn(async () => {})
    const run = vi.fn(() => probe)

    const pending = runActionsProbeWithLease({
      beginMutation: async () => release,
      engineId: () => 'mx.iblis.engine.acestep',
      engineVersion: () => '0.1.4',
      run
    })

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(release).not.toHaveBeenCalled()
    finishProbe({
      ranAt: 1,
      engineId: 'mx.iblis.engine.acestep',
      engineVersion: '0.1.4',
      task: 'repaint-extend',
      sourceSec: PROBE_SOURCE_SEC,
      requestedExtendSec: PROBE_EXTEND_SEC,
      outputSec: PROBE_SOURCE_SEC + PROBE_EXTEND_SEC,
      toleranceSec: 1.5,
      elapsedMs: 2,
      passed: true,
      mediaAvailable: true,
      note: 'audible check required'
    })
    await expect(pending).resolves.toMatchObject({ passed: true })
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('releases the lease when the probe fails', async () => {
    const release = vi.fn(async () => {})
    await expect(
      runActionsProbeWithLease({
        beginMutation: async () => release,
        engineId: () => 'mx.iblis.engine.acestep',
        engineVersion: () => '0.1.4',
        run: async () => {
          throw new Error('probe failed')
        }
      })
    ).rejects.toThrow('probe failed')
    expect(release).toHaveBeenCalledTimes(1)
  })
})
