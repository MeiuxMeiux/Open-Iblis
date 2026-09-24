// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Engine contract v2 slice 4 (planning packet 2026-07-21): the generic v2
// job client against the REAL fixture sidecar process — deliberately non-ACE
// models, phases, endpoints, and controls. Proves on-demand start, strict
// state parsing, staged output containment, WAV re-validation, cancel, and
// the hostile modes (descriptor broadening, staging escape, engine failure).

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  parseEngineDescriptorV2,
  type EngineDescriptorV2,
  type GenerateRequest
} from '@iblis/plugin-sdk'
import { parseWav, type WavMetadata } from '../electron/main/media/wav'
import { fetchLiveDescriptor } from '../electron/main/engine/drivers/v2/descriptor'
import {
  buildRecipe,
  resolveV2Request,
  v2CanonicalRequestError
} from '../electron/main/engine/drivers/v2/request'
import { v2Capabilities } from '../electron/main/engine/drivers/v2/capabilities'
import { createEngineV2Client, type V2JobContext } from '../electron/main/engine/drivers/v2/jobs'

const FIXTURE_BIN = join(
  __dirname,
  '../../../packages/plugins/fixture-engine/src/fixture-engine.cjs'
)
const DESCRIPTOR_PATH = join(__dirname, '../../../packages/plugins/fixture-engine/engine.v2.json')
const SESSION = randomBytes(12).toString('hex')

const signedBytes = readFileSync(DESCRIPTOR_PATH)
const signedParse = parseEngineDescriptorV2(JSON.parse(signedBytes.toString('utf8')))
if (!signedParse.ok) throw new Error(signedParse.errors.join('\n'))
const signed: EngineDescriptorV2 = signedParse.value
const signedHash = createHash('sha256').update(signedBytes).digest('hex')

interface Sidecar {
  port: number
  child: ChildProcess
}

const sidecars: Sidecar[] = []
const tmpRoots: string[] = []

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('no port')))
      }
    })
  })
}

async function launchFixture(env: Record<string, string> = {}): Promise<Sidecar> {
  const port = await freePort()
  const child = spawn(process.execPath, [FIXTURE_BIN, '--port', String(port)], {
    env: { ...process.env, IBLIS_SESSION: SESSION, IBLIS_FIXTURE_JOB_MS: '120', ...env },
    stdio: 'ignore'
  })
  const sidecar = { port, child }
  sidecars.push(sidecar)
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await request(sidecar, '/health')
      if (res.ok) return sidecar
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('fixture engine never became healthy')
}

function request(sidecar: Sidecar, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-Iblis-Session', SESSION)
  return fetch(`http://127.0.0.1:${sidecar.port}${path}`, { ...init, headers })
}

interface Harness {
  client: ReturnType<typeof createEngineV2Client>
  written: { jobId: string; bytes: Buffer; metadata: WavMetadata }[]
  extras: { trackId: string; role: string; bytes: Buffer }[]
  evidence: {
    trackId: string
    jobId: string
    context: V2JobContext
    kept: Partial<Record<'preview', string>>
  }[]
  stagingRoot: string
  started: string[]
}

function harness(sidecar: Sidecar): Harness {
  const stagingRoot = mkdtempSync(join(tmpdir(), 'iblis-v2-staging-'))
  tmpRoots.push(stagingRoot)
  const written: Harness['written'] = []
  const extras: Harness['extras'] = []
  const evidence: Harness['evidence'] = []
  const started: string[] = []
  const engine = { id: 'mx.iblis.engine.fixture', version: '0.1.0' }
  const client = createEngineV2Client({
    fetch: (_engineId, path, init) => request(sidecar, path, init),
    async prepare(req: GenerateRequest): Promise<V2JobContext> {
      // Mirrors the driver: on-demand bring-up, live facts, exact recipe.
      started.push(engine.id)
      const descriptor = await fetchLiveDescriptor(
        (path, init) => request(sidecar, path, init),
        signed
      )
      const recipe = buildRecipe(resolveV2Request(req, signed), {
        providerId: 'engine-v2:mx.iblis.engine.fixture',
        pluginVersion: engine.version,
        descriptorHash: signedHash,
        descriptor
      })
      return { engine, recipe, descriptor }
    },
    stagingRoot: () => stagingRoot,
    async writeWav(jobId, bytes, _req, metadata) {
      written.push({ jobId, bytes, metadata })
      return { trackId: `track-${written.length}` }
    },
    async writeExtra(trackId, role, bytes) {
      extras.push({ trackId, role, bytes })
      return true
    },
    async writeEvidence(trackId, jobId, context, _phases, kept) {
      evidence.push({ trackId, jobId, context, kept })
    },
    pollIntervalMs: 25
  })
  return { client, written, extras, evidence, stagingRoot, started }
}

afterAll(() => {
  for (const sidecar of sidecars) sidecar.child.kill('SIGKILL')
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true })
})

const draft: GenerateRequest = {
  prompt: 'a quiet clockwork miniature',
  durationSec: 2,
  preset: 'sketchbook',
  seed: 41,
  config: { bpm: 120 }
}

describe('fixture sidecar wire', () => {
  it('refuses requests without the session header', async () => {
    const sidecar = await launchFixture()
    const res = await fetch(`http://127.0.0.1:${sidecar.port}/v2/descriptor`)
    expect(res.status).toBe(401)
  })

  it('serves a live descriptor that matches the signed one', async () => {
    const sidecar = await launchFixture()
    const live = await fetchLiveDescriptor((path, init) => request(sidecar, path, init), signed)
    expect(live.engineFamily).toBe('iblis-fixture')
    expect(live.phases).toEqual(['prime', 'sketch', 'varnish'])
  })
})

describe('v2 job client against the real fixture', () => {
  it('runs a take end to end: real WAV out, outputs contained, staging cleaned', async () => {
    const sidecar = await launchFixture()
    const h = harness(sidecar)
    const { jobId } = h.client.generate(draft)
    const settled = await h.client.settled(jobId)
    expect(settled?.status).toBe('done')
    expect(settled?.result?.trackId).toBe('track-1')
    expect(h.started).toEqual(['mx.iblis.engine.fixture'])
    expect(h.written).toHaveLength(1)
    const wav = parseWav(h.written[0]!.bytes)
    expect(wav.durationSec).toBeGreaterThan(1.5)
    expect(wav.durationSec).toBeLessThan(2.5)
    expect(h.evidence[0]?.context.recipe.descriptorHash).toBe(signedHash)
    expect(h.evidence[0]?.context.recipe.profileId).toBe('sketchbook')
    expect(existsSync(join(h.stagingRoot, jobId))).toBe(false)
    // The declared preview output is retained as a validated WAV sibling and
    // named in the evidence, not thrown away with the staging directory.
    expect(h.extras).toHaveLength(1)
    expect(h.extras[0]?.role).toBe('preview')
    expect(parseWav(h.extras[0]!.bytes).durationSec).toBeGreaterThan(0)
    expect(h.evidence[0]?.kept.preview).toBe('preview.wav')
  })

  it('cancels a running take and cleans its staging', async () => {
    const sidecar = await launchFixture({ IBLIS_FIXTURE_JOB_MS: '60000' })
    const h = harness(sidecar)
    const { jobId } = h.client.generate(draft)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await h.client.cancel(jobId)
    const settled = await h.client.settled(jobId)
    expect(settled?.status).toBe('error')
    expect(settled?.error?.code).toBe('job_cancelled')
    expect(h.written).toHaveLength(0)
    expect(existsSync(join(h.stagingRoot, jobId))).toBe(false)
  })

  it('surfaces a bounded engine failure', async () => {
    const sidecar = await launchFixture({ IBLIS_FIXTURE_MODE: 'fail' })
    const h = harness(sidecar)
    const { jobId } = h.client.generate(draft)
    const settled = await h.client.settled(jobId)
    expect(settled?.status).toBe('error')
    expect(settled?.error?.code).toBe('paint_dry')
    expect(h.written).toHaveLength(0)
  })

  it('refuses an output path that escapes staging', async () => {
    const sidecar = await launchFixture({ IBLIS_FIXTURE_MODE: 'escape' })
    const h = harness(sidecar)
    const { jobId } = h.client.generate(draft)
    const settled = await h.client.settled(jobId)
    expect(settled?.status).toBe('error')
    expect(settled?.error?.code).toBe('bad_outputs')
    expect(h.written).toHaveLength(0)
  })

  it('refuses a live descriptor that broadens the signed claims', async () => {
    const sidecar = await launchFixture({ IBLIS_FIXTURE_MODE: 'broaden' })
    const h = harness(sidecar)
    const { jobId } = h.client.generate(draft)
    const settled = await h.client.settled(jobId)
    expect(settled?.status).toBe('error')
    expect(settled?.error?.message).toContain('broadens')
    expect(h.written).toHaveLength(0)
  })
})

describe('v2 request translation', () => {
  it('canonicalizes a draft: default profile, materialized seed, stripped tuning', () => {
    const resolved = resolveV2Request(
      {
        prompt: 'p',
        durationSec: 10,
        preset: '',
        config: { bpm: 90, steps: 8, guidance: 3, solver: 'euler', lmModel: 'x' }
      },
      signed
    )
    expect(resolved.preset).toBe('sketchbook')
    expect(resolved.seed).toBeTypeOf('number')
    expect(resolved.config).toEqual({ bpm: 90 })
    expect(v2CanonicalRequestError(resolved)).toBeNull()
  })

  it('refuses what cannot be silently dropped: styles, lyrics, out-of-range length', () => {
    expect(() =>
      resolveV2Request(
        { prompt: 'p', durationSec: 10, preset: '', config: { adapter: 'style' } },
        signed
      )
    ).toThrow(/styles/)
    expect(() =>
      resolveV2Request({ prompt: 'p', lyrics: 'la', durationSec: 10, preset: '' }, signed)
    ).toThrow(/lyrics/)
    expect(() => resolveV2Request({ prompt: 'p', durationSec: 3000, preset: '' }, signed)).toThrow(
      /seconds/
    )
  })

  it('builds a recipe the SDK parsers accept and pins the descriptor hash', () => {
    const resolved = resolveV2Request(draft, signed)
    const recipe = buildRecipe(resolved, {
      providerId: 'engine-v2:mx.iblis.engine.fixture',
      pluginVersion: '0.1.0',
      descriptorHash: signedHash,
      descriptor: signed
    })
    expect(recipe.operation).toBe('music.generate')
    expect(recipe.descriptorHash).toBe(signedHash)
    expect(recipe.profileId).toBe('sketchbook')
    expect(recipe.common?.bpm).toBe(120)
  })

  it('admits declared advanced controls within bounds and drops undeclared ids', () => {
    const resolved = resolveV2Request(
      {
        prompt: 'p',
        durationSec: 10,
        preset: 'gallery',
        config: { advanced: { canvas: 'mural', layers: 5, crackle: true, ghost: 1 } }
      },
      signed
    )
    expect(resolved.config?.advanced).toEqual({ canvas: 'mural', layers: 5, crackle: true })
    expect(v2CanonicalRequestError(resolved)).toBeNull()
    const recipe = buildRecipe(resolved, {
      providerId: 'engine-v2:mx.iblis.engine.fixture',
      pluginVersion: '0.1.0',
      descriptorHash: signedHash,
      descriptor: signed
    })
    expect(recipe.advanced).toEqual({ canvas: 'mural', layers: 5, crackle: true })
  })

  it('refuses out-of-bounds advanced values by the control label', () => {
    const base = { prompt: 'p', durationSec: 10, preset: 'gallery' }
    expect(() =>
      resolveV2Request({ ...base, config: { advanced: { layers: 9 } } }, signed)
    ).toThrow(/Layers: must be 1 through 8/)
    expect(() =>
      resolveV2Request({ ...base, config: { advanced: { layers: 2.5 } } }, signed)
    ).toThrow(/whole number/)
    expect(() =>
      resolveV2Request({ ...base, config: { advanced: { canvas: 'fresco' } } }, signed)
    ).toThrow(/Canvas: must be one of miniature, mural/)
    expect(() =>
      resolveV2Request({ ...base, config: { advanced: { crackle: 'yes' } } }, signed)
    ).toThrow(/Crackle/)
    expect(
      v2CanonicalRequestError({ ...base, config: { advanced: { 'bad id!': true } } })
    ).toContain('control id')
    expect(v2CanonicalRequestError({ ...base, config: { advanced: [] } })).toContain('object')
  })

  it('derives Create capabilities from the signed descriptor only', () => {
    const caps = v2Capabilities(signed)
    expect(caps.protocol).toBe(2)
    expect(caps.lyrics).toBe('none')
    expect(caps.styles).toBe(false)
    expect(caps.seed).toBe(true)
    expect(caps.nativeTuning).toBe(false)
    expect(caps.commonControls).toEqual(['bpm'])
    expect(caps.advancedControls.map((control) => control.id)).toEqual([
      'canvas',
      'layers',
      'crackle'
    ])
    expect(caps.duration).toEqual({ minSec: 1, maxSec: 120 })
    expect(caps.outputs).toEqual(['mix', 'preview'])
  })

  it('rejects a canonical request carrying non-v2 controls', () => {
    expect(
      v2CanonicalRequestError({
        prompt: 'p',
        durationSec: 10,
        preset: 'sketchbook',
        config: { steps: 8 }
      })
    ).toContain('steps')
  })
})
