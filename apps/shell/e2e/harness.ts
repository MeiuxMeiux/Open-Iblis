// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Playwright-over-Electron harness for the renderer E2E suite (`just
// shell-e2e`). Each launch gets a disposable data environment (HOME, data,
// tracks, plugins, caches) and every remote base points at a loopback fixture
// server, so a run never touches the network or the developer's own install.
// The catalog fixture is a verbatim snapshot of the published signed feed:
// the shell verifies it against the baked-in key exactly as it would live.

import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright-core'
import { afterAll, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import { makeWav } from '../tests/fixtures/wav'

const require = createRequire(import.meta.url)

const SHELL_ROOT = join(import.meta.dirname, '..')
const FIXTURES = join(import.meta.dirname, 'fixtures')
const PLUGIN_SOURCES = join(SHELL_ROOT, '..', '..', 'packages', 'plugins')

export interface FixtureServer {
  base: string
  requests: string[]
  close(): Promise<void>
}

// Serves the v2 catalog pair; every other path is a recorded 404, so a test
// can assert which remote calls a flow made without any real endpoint.
export async function startFixtureServer(): Promise<FixtureServer> {
  const routes = new Map<string, Buffer>([
    ['/api/v2/catalog.json', readFileSync(join(FIXTURES, 'catalog.json'))],
    ['/api/v2/catalog.json.sig', readFileSync(join(FIXTURES, 'catalog.json.sig'))]
  ])
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://fixture').pathname
    requests.push(path)
    const body = routes.get(path)
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/octet-stream' })
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

// Four seconds of a 440 Hz tone: long enough that playback visibly advances.
export function toneWav(seconds = 4, rate = 44100): Buffer {
  const data = Buffer.alloc(seconds * rate * 2)
  for (let i = 0; i < seconds * rate; i++) {
    data.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2)
  }
  return makeWav({ sampleRateHz: rate, bitsPerSample: 16, data })
}

export interface ShellEnv {
  root: string
  tracks: string
  // Extra environment for the app process (e.g. a PATH with fake tools).
  env: Record<string, string>
  dispose(): void
}

interface CatalogAsset {
  path: string
  sha256: string
  bytes: number
}

interface SeedManifest {
  id: string
  version: string
  assets: CatalogAsset[]
  manifestSource: { assets: { path: string; file: string }[] }
}

// A plugin as install.ts leaves it: <plugins>/<id>/<version>/ holding the
// assets and manifest.json, plus current.txt. The manifest is the signed
// catalog entry; asset bytes come from the plugin's source tree (the published
// fixture engine differs from it by the SPDX header only), so each asset's
// hash and size are restated for the bytes actually seeded.
function seedPlugin(pluginsDir: string, id: string, sourceDir: string): void {
  const catalog = JSON.parse(readFileSync(join(FIXTURES, 'catalog.json'), 'utf8')) as {
    plugins: { manifest: Omit<SeedManifest, 'manifestSource'> }[]
  }
  const manifest = catalog.plugins.find((p) => p.manifest.id === id)?.manifest
  if (!manifest) throw new Error(`${id} is not in the catalog fixture`)
  const source = JSON.parse(
    readFileSync(join(PLUGIN_SOURCES, sourceDir, 'manifest.source.json'), 'utf8')
  ) as SeedManifest['manifestSource']
  const versionDir = join(pluginsDir, id, manifest.version)
  mkdirSync(versionDir, { recursive: true })
  for (const asset of manifest.assets) {
    const file = source.assets.find((a) => a.path === asset.path)?.file
    if (!file) throw new Error(`${id}: no source for ${asset.path}`)
    const bytes = readFileSync(join(PLUGIN_SOURCES, sourceDir, file))
    writeFileSync(join(versionDir, asset.path), bytes)
    asset.sha256 = createHash('sha256').update(bytes).digest('hex')
    asset.bytes = bytes.length
  }
  writeFileSync(join(versionDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(pluginsDir, id, 'current.txt'), `${manifest.version}\n`)
}

// Catalog plugins a spec can pre-install, by source directory.
const SEEDABLE = { 'fixture-engine': 'mx.iblis.engine.fixture' } as const

// The training pack stand-in (fixtures/training-pack): a Node sidecar that
// speaks the Python trainer's loopback wire. It is not a catalog plugin, so
// its manifest is local and its one asset is hashed as seeded.
function seedTrainingPack(pluginsDir: string): void {
  const source = join(FIXTURES, 'training-pack')
  const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8')) as Omit<
    SeedManifest,
    'manifestSource'
  >
  const versionDir = join(pluginsDir, manifest.id, manifest.version)
  mkdirSync(versionDir, { recursive: true })
  for (const asset of manifest.assets) {
    const bytes = readFileSync(join(source, asset.path))
    writeFileSync(join(versionDir, asset.path), bytes)
    asset.sha256 = createHash('sha256').update(bytes).digest('hex')
    asset.bytes = bytes.length
  }
  writeFileSync(join(versionDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(pluginsDir, manifest.id, 'current.txt'), `${manifest.version}\n`)
}

// hardware/index.ts reads VRAM from nvidia-smi on PATH; this one answers the
// same CSV query with a fixed card.
function fakeNvidiaSmi(binDir: string, totalMb: number): void {
  mkdirSync(binDir)
  const script = join(binDir, 'nvidia-smi')
  writeFileSync(script, `#!/bin/sh\necho "${String(totalMb)}, 512"\n`)
  chmodSync(script, 0o755)
}

export interface ShellSeed {
  // A WAV left in the tracks root is swept into the library on launch
  // (library/import.ts), which is how a test seeds a playable track.
  wavs?: Record<string, Buffer>
  plugins?: (keyof typeof SEEDABLE)[]
  trainingPack?: boolean
  // Total VRAM the fake nvidia-smi reports; omitted means no GPU at all.
  gpuVramMb?: number
  // Main-side training job records, written as the durable jobs.json. Paths
  // inside them may use {root}, replaced by the env's root directory.
  trainingJobs?: Record<string, unknown>[]
}

export function createShellEnv(seed: ShellSeed = {}): ShellEnv {
  const root = mkdtempSync(join(tmpdir(), 'iblis-e2e-'))
  const tracks = join(root, 'tracks')
  for (const dir of ['home', 'data', 'tracks', 'plugins', 'adapters', 'catalog-cache']) {
    mkdirSync(join(root, dir))
  }
  for (const [name, bytes] of Object.entries(seed.wavs ?? {})) {
    writeFileSync(join(tracks, name), bytes)
  }
  for (const dir of seed.plugins ?? []) seedPlugin(join(root, 'plugins'), SEEDABLE[dir], dir)
  if (seed.trainingPack) seedTrainingPack(join(root, 'plugins'))
  const env: Record<string, string> = {}
  if (seed.gpuVramMb !== undefined) {
    fakeNvidiaSmi(join(root, 'bin'), seed.gpuVramMb)
    env.PATH = `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`
  }
  if (seed.trainingJobs) {
    mkdirSync(join(root, 'data', 'training'))
    const jobs = JSON.stringify({ version: 1, jobs: seed.trainingJobs }).replaceAll('{root}', root)
    writeFileSync(join(root, 'data', 'training', 'jobs.json'), jobs)
  }
  return { root, tracks, env, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

export interface Shell {
  app: ElectronApplication
  win: Page
  // Console errors and uncaught page exceptions, in arrival order.
  errors: string[]
  close(): Promise<void>
}

// `just shell-e2e-coverage` sets IBLIS_E2E_COVERAGE to a directory: the main
// process writes V8 coverage there on exit (NODE_V8_COVERAGE) and the renderer's
// is taken over CDP on close. scripts/e2e-coverage.ts maps both to source.
const COVERAGE_DIR = process.env.IBLIS_E2E_COVERAGE

async function startRendererCoverage(win: Page): Promise<() => Promise<void>> {
  const cdp = await win.context().newCDPSession(win)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  // Module top-level code already ran; a reload counts it under coverage.
  await win.reload()
  return async () => {
    const { result } = await cdp.send('Profiler.takePreciseCoverage')
    const dir = join(COVERAGE_DIR ?? '', 'renderer')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `${String(Date.now())}-${String(process.pid)}.json`),
      JSON.stringify({ result })
    )
  }
}

export async function launchShell(env: ShellEnv, fixture: FixtureServer): Promise<Shell> {
  const app = await _electron.launch({
    args: ['--no-sandbox', '--disable-gpu', '--mute-audio', join(SHELL_ROOT, 'out/main/index.js')],
    cwd: SHELL_ROOT,
    env: {
      ...process.env,
      HOME: join(env.root, 'home'),
      XDG_CONFIG_HOME: join(env.root, 'home', '.config'),
      IBLIS_DATA_DIR: join(env.root, 'data'),
      IBLIS_TRACKS_DIR: env.tracks,
      IBLIS_PLUGINS_DIR: join(env.root, 'plugins'),
      IBLIS_ADAPTERS_DIR: join(env.root, 'adapters'),
      IBLIS_CATALOG_CACHE_DIR: join(env.root, 'catalog-cache'),
      IBLIS_CATALOG_BASE: `${fixture.base}/api/v2`,
      IBLIS_KEYS_BASE: `${fixture.base}/api/v1/keys`,
      IBLIS_TRAININGS_BASE: `${fixture.base}/api/v1/trainings`,
      IBLIS_TRAININGS_INDEX_BASE: `${fixture.base}/trainings`,
      IBLIS_LAB_CATALOG_BASE: `${fixture.base}/api/labs`,
      ...(COVERAGE_DIR ? { NODE_V8_COVERAGE: join(COVERAGE_DIR, 'main') } : {}),
      ...env.env
    }
  })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  win.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  await win.waitForLoadState('domcontentloaded')
  const takeCoverage = COVERAGE_DIR ? await startRendererCoverage(win) : null
  await win.getByRole('navigation', { name: 'Primary' }).waitFor()
  const close = async (): Promise<void> => {
    await takeCoverage?.()
    await app.close()
  }
  return { app, win, errors, close }
}

export interface Session {
  fixture: FixtureServer
  env: ShellEnv
  shell: Shell
}

// One fixture server, data env and app instance for a whole spec file,
// torn down after its last test. Read the fields inside tests, not at load.
export function useShell(seed: ShellSeed = {}): Session {
  const session = {} as Session
  beforeAll(async () => {
    session.fixture = await startFixtureServer()
    session.env = createShellEnv(seed)
    session.shell = await launchShell(session.env, session.fixture)
  })
  afterAll(async () => {
    await session.shell.close()
    await session.fixture.close()
    session.env.dispose()
  })
  return session
}

export async function openView(win: Page, label: string): Promise<void> {
  const nav = win.getByRole('navigation', { name: 'Primary' })
  await nav.getByRole('button', { name: label, exact: true }).click()
  await nav
    .getByRole('button', { name: label, exact: true })
    .and(win.locator('[aria-current="page"]'))
    .waitFor()
}

// The shell's Linux window backdrop (electron/main/window.ts). The body is
// deliberately translucent over the window, and axe would otherwise composite
// it over a white canvas. On Windows the backdrop is Mica, which this Linux
// suite cannot model.
const WINDOW_BACKDROP = '#0c0b10'

export interface AxeViolation {
  id: string
  impact: string | null
  nodes: string[]
}

// axe-core in the live renderer. Evaluated over CDP, so the page CSP (no
// inline scripts) does not apply to the injected source.
export async function axeViolations(win: Page): Promise<AxeViolation[]> {
  // A control left under the pointer by the last click renders its hover
  // colors, which can mask a contrast failure in its resting state.
  await win.mouse.move(0, 0)
  const source = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
  await win.evaluate(source)
  return win.evaluate(async (backdrop) => {
    document.documentElement.style.background = backdrop
    interface AxeResult {
      violations: {
        id: string
        impact: string | null
        nodes: { target: string[]; failureSummary?: string }[]
      }[]
    }
    const { axe } = globalThis as unknown as { axe: { run(): Promise<AxeResult> } }
    try {
      const result = await axe.run()
      return result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`)
      }))
    } finally {
      document.documentElement.style.background = ''
    }
  }, WINDOW_BACKDROP)
}
