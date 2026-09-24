// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Engine contract v2 slice 5: the registry routes v1/v2 by signed manifest
// facts, defaults are per-operation and deterministic, queued work carries an
// exact target that execution verifies, and a v2 engine starts on demand
// through the real supervisor — all without an engine-id branch in shared
// code. Uses the real plugins registry on disk and the real fixture sidecar.

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GenerateRequest } from '@iblis/plugin-sdk'

const mocks = vi.hoisted(() => ({
  addGeneratedTrack: vi.fn(async () => ({ id: 'track-registry-1' })),
  recordPromptUse: vi.fn(async () => {}),
  saveTrackGeneration: vi.fn<(id: string, evidence: unknown) => Promise<void>>(async () => {}),
  saveTrackSiblingOutput: vi.fn(async () => true)
}))
vi.mock('../electron/main/library', () => mocks)

const FIXTURE_DIR = join(__dirname, '../../../packages/plugins/fixture-engine')
const FIXTURE_ID = 'mx.iblis.engine.fixture'
const LEGACY_ID = 'mx.iblis.engine.legacy'

let pluginsRoot: string

function installFixturePack(): void {
  const dir = join(pluginsRoot, FIXTURE_ID, '0.1.0')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id: FIXTURE_ID,
      name: 'Fixture Engine',
      version: '0.1.0',
      kind: 'engine',
      hostMinVersion: '0.0.0',
      capabilities: ['text-to-music'],
      engine: { protocolVersion: 2, descriptorAsset: 'engine.v2.json', execution: 'local-sidecar' },
      executable: { bin: 'fixture-engine.cjs', healthPath: '/health', healthTimeoutMs: 5000 },
      assets: [],
      license: 'MIT',
      author: { name: 'test' }
    })
  )
  copyFileSync(join(FIXTURE_DIR, 'engine.v2.json'), join(dir, 'engine.v2.json'))
  copyFileSync(join(FIXTURE_DIR, 'src/fixture-engine.cjs'), join(dir, 'fixture-engine.cjs'))
  writeFileSync(join(pluginsRoot, FIXTURE_ID, 'current.txt'), '0.1.0')
}

function installLegacyPack(): void {
  const dir = join(pluginsRoot, LEGACY_ID, '1.0.0')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id: LEGACY_ID,
      name: 'Legacy Engine',
      version: '1.0.0',
      kind: 'engine',
      hostMinVersion: '0.0.0',
      capabilities: ['text-to-music'],
      assets: [],
      license: 'MIT',
      author: { name: 'test' }
    })
  )
  writeFileSync(join(pluginsRoot, LEGACY_ID, 'current.txt'), '1.0.0')
}

beforeAll(() => {
  pluginsRoot = mkdtempSync(join(tmpdir(), 'iblis-registry-'))
  process.env.IBLIS_PLUGINS_DIR = pluginsRoot
  process.env.IBLIS_FIXTURE_JOB_MS = '120'
  installFixturePack()
  installLegacyPack()
})

afterAll(async () => {
  const { stopAll } = await import('../electron/main/sidecar/supervisor')
  await stopAll()
  const { setDefaultEngine } = await import('../electron/main/engine/defaults')
  setDefaultEngine('music.generate', null)
  delete process.env.IBLIS_PLUGINS_DIR
  delete process.env.IBLIS_FIXTURE_JOB_MS
  rmSync(pluginsRoot, { recursive: true, force: true })
})

async function registry() {
  const { engineProvider } = await import('../electron/main/engine')
  return engineProvider()
}

const draft: GenerateRequest = {
  prompt: 'registry proof miniature',
  durationSec: 2,
  preset: 'sketchbook',
  seed: 9,
  config: { bpm: 100 }
}

describe('engine registry routing and selection', () => {
  it('lists both engines with their protocols and one selected default', async () => {
    const provider = await registry()
    const engines = provider.listEngineSummaries()
    expect(engines.map((engine) => engine.id).sort()).toEqual([FIXTURE_ID, LEGACY_ID])
    expect(engines.find((engine) => engine.id === FIXTURE_ID)?.protocol).toBe(2)
    expect(engines.find((engine) => engine.id === LEGACY_ID)?.protocol).toBe(1)
    expect(engines.filter((engine) => engine.selected)).toHaveLength(1)
    const fixture = engines.find((engine) => engine.id === FIXTURE_ID)!
    expect(fixture.readiness).toBe('ready')
    expect(fixture.startsOnDemand).toBe(true)
    expect(fixture.models).toEqual(['pastiche-mini@r3', 'pastiche-grand@r1'])
    expect(fixture.operations).toEqual(['music.generate'])
    expect(fixture.styles).toBe(false)
    expect(fixture.lyrics).toBe(false)
    expect(fixture.duration).toEqual({ minSec: 1, maxSec: 120 })
    expect(fixture.installBytes).toBeTypeOf('number')
    const legacy = engines.find((engine) => engine.id === LEGACY_ID)!
    expect(legacy.readiness).toBe('stopped')
    expect(legacy.styles).toBe(true)
    expect(legacy.duration).toEqual({ minSec: 4, maxSec: 240 })
  })

  it('selection is per-operation, persisted, and reflected in the target snapshot', async () => {
    const provider = await registry()
    provider.selectEngine(LEGACY_ID)
    expect(provider.currentTarget()).toEqual({
      pluginId: LEGACY_ID,
      version: '1.0.0',
      protocol: 1
    })
    provider.selectEngine(FIXTURE_ID)
    const target = provider.currentTarget()
    expect(target?.pluginId).toBe(FIXTURE_ID)
    expect(target?.protocol).toBe(2)
    expect(target?.descriptorHash).toMatch(/^[0-9a-f]{64}$/)
    const { resetEngineDefaultsCache, defaultEngineFor } =
      await import('../electron/main/engine/defaults')
    resetEngineDefaultsCache()
    expect(defaultEngineFor('music.generate')).toBe(FIXTURE_ID)
    expect(() => provider.selectEngine('mx.iblis.engine.absent')).toThrow(/not an installed/)
  })

  it('reports v2 facts from the signed descriptor while the engine is stopped', async () => {
    const provider = await registry()
    provider.selectEngine(FIXTURE_ID)
    const info = await provider.engineInfo()
    expect(info.id).toBe(FIXTURE_ID)
    expect(info.running).toBe(false)
    expect(info.startsOnDemand).toBe(true)
    expect(info.profiles.map((profile) => profile.id)).toEqual(['sketchbook', 'gallery'])
    expect(info.runtime?.synthModels).toContain('pastiche-mini@r3')
  })

  it('admission resolves through the selected v2 driver, stripping foreign tuning', async () => {
    const provider = await registry()
    provider.selectEngine(FIXTURE_ID)
    const resolved = await provider.resolveQueuedRequest({
      prompt: 'p',
      durationSec: 10,
      preset: '',
      config: { bpm: 90, steps: 8, guidance: 2 }
    })
    expect(resolved.preset).toBe('sketchbook')
    expect(resolved.config).toEqual({ bpm: 90 })
  })

  it('refuses a drifted or missing target with an actionable error', async () => {
    const provider = await registry()
    const stale = provider.startGenerate(draft, undefined, {
      pluginId: FIXTURE_ID,
      version: '0.0.9',
      protocol: 2,
      descriptorHash: '0'.repeat(64)
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error).toContain('changed after this take was queued')

    const gone = provider.startGenerate(draft, undefined, {
      pluginId: 'mx.iblis.engine.absent',
      version: '1.0.0',
      protocol: 2
    })
    expect(gone.ok).toBe(false)
    if (!gone.ok) expect(gone.error).toContain('no longer installed')

    const tampered = provider.startGenerate(draft, undefined, {
      pluginId: FIXTURE_ID,
      version: '0.1.0',
      protocol: 2,
      descriptorHash: 'f'.repeat(64)
    })
    expect(tampered.ok).toBe(false)
    if (!tampered.ok) expect(tampered.error).toContain('signed capabilities changed')
  })

  it('runs an exact v2 target end to end, starting the sidecar on demand', async () => {
    const provider = await registry()
    provider.selectEngine(FIXTURE_ID)
    const target = provider.currentTarget()
    expect(target).not.toBeNull()
    const started = provider.startGenerate(draft, undefined, target!)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(provider.activeEngineId()).toBe(FIXTURE_ID)
    const settled = await provider.settled(started.data.jobId)
    expect(settled?.status).toBe('done')
    expect(settled?.result?.trackId).toBe('track-registry-1')
    expect(mocks.addGeneratedTrack).toHaveBeenCalledTimes(1)
    expect(mocks.saveTrackGeneration).toHaveBeenCalledTimes(1)
    expect(mocks.saveTrackSiblingOutput).toHaveBeenCalledWith(
      'track-registry-1',
      'preview',
      expect.any(Buffer)
    )
    const recorded = mocks.saveTrackGeneration.mock.calls[0]?.[1] as {
      effectiveRequest: Record<string, unknown>
    }
    expect(recorded.effectiveRequest.preview_output).toBe('preview.wav')
    expect(recorded.effectiveRequest.model_id).toBe('pastiche-mini')
    expect(recorded.effectiveRequest.engine_family).toBe('iblis-fixture')
    const { healthAll } = await import('../electron/main/sidecar/supervisor')
    expect(healthAll()[FIXTURE_ID]?.running).toBe(true)
  })

  it('refuses a comparison against a v2 engine with a clear message', async () => {
    const provider = await registry()
    provider.selectEngine(FIXTURE_ID)
    await expect(provider.resolveComparisonPair(draft, { profileId: 'gallery' })).rejects.toThrow(
      /blind comparisons/
    )
  })
})
