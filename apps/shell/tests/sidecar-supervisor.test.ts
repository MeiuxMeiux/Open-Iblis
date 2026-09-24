// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginManifest } from '@iblis/plugin-sdk'
import { install } from '../electron/main/plugins/registry'
import {
  start,
  hotSwap,
  stop,
  stopAll,
  portOf,
  requestSidecar,
  simulateCrash,
  healthAll
} from '../electron/main/sidecar/supervisor'

// Spawns the REAL echo-server stub as a child process on this box and drives
// the full supervisor: launch -> health, hot-swap (version visibly changes),
// crash-restart, and kill-on-stop. A v0.1.1 is synthesized by rewriting the
// hard-coded VERSION in the stub source, so /health proves which one is live.

const ID = 'mx.iblis.processor.echo'
const SRC = readFileSync(
  join(__dirname, '../../../packages/plugins/echo-server/src/echo-server.cjs')
)

function bodyFor(version: string): Buffer {
  return Buffer.from(
    SRC.toString('utf8').replace("const VERSION = '0.1.0'", `const VERSION = '${version}'`)
  )
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

let server: Server
let assets: Record<string, Buffer> = {}
let baseUrl = ''
let root = ''

function manifest(version: string): PluginManifest {
  const body = assets[`/${version}/echo-server.cjs`]!
  return {
    id: ID,
    name: 'Echo Server',
    version,
    kind: 'processor',
    hostMinVersion: '0.0.0',
    capabilities: ['echo'],
    assets: [
      {
        path: 'echo-server.cjs',
        sha256: sha256(body),
        bytes: body.length,
        sources: [{ kind: 'gcs', url: `${baseUrl}/${version}/echo-server.cjs` }]
      }
    ],
    executable: { bin: 'echo-server.cjs', healthPath: '/health', healthTimeoutMs: 5000 },
    license: 'MIT',
    author: { name: 'Meiux Meiux LLC' }
  }
}

async function installVersion(version: string): Promise<PluginManifest> {
  assets[`/${version}/echo-server.cjs`] = bodyFor(version)
  const m = manifest(version)
  await install(m)
  return m
}

async function liveVersion(): Promise<string> {
  const res = await requestSidecar(ID, '/health')
  return ((await res.json()) as { version: string }).version
}

async function waitUntil(cond: () => Promise<boolean>, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await cond().catch(() => false)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('condition not met in time')
}

beforeEach(async () => {
  assets = {}
  server = createServer((req, res) => {
    const body = assets[req.url ?? '']
    if (!body) {
      res.statusCode = 404
      res.end('nope')
      return
    }
    res.end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  root = mkdtempSync(join(tmpdir(), 'iblis-sidecar-'))
  process.env.IBLIS_PLUGINS_DIR = root
})

afterEach(async () => {
  await stopAll()
  delete process.env.IBLIS_PLUGINS_DIR
  rmSync(root, { recursive: true, force: true })
  await new Promise<void>((r) => server.close(() => r()))
})

describe('sidecar supervisor', () => {
  it('launches the stub and reports it healthy', async () => {
    await start(await installVersion('0.1.0'))
    expect(portOf(ID)).toBeGreaterThan(0)
    expect(await liveVersion()).toBe('0.1.0')
  })

  it('rejects requests without the session secret (401)', async () => {
    await start(await installVersion('0.1.0'))
    const res = await fetch(`http://127.0.0.1:${portOf(ID)}/health`) // no header
    expect(res.status).toBe(401)
  })

  it('hot-swaps to a new version and retires the old process', async () => {
    await start(await installVersion('0.1.0'))
    const oldPort = portOf(ID)
    await hotSwap(await installVersion('0.1.1'))

    expect(portOf(ID)).not.toBe(oldPort)
    expect(await liveVersion()).toBe('0.1.1')
    await expect(fetch(`http://127.0.0.1:${oldPort}/health`)).rejects.toThrow() // old port dead
  })

  it('restarts the sidecar after an unexpected crash', async () => {
    await start(await installVersion('0.1.0'))
    const oldPort = portOf(ID)
    simulateCrash(ID)
    await waitUntil(async () => {
      const p = portOf(ID)
      return p !== null && p !== oldPort && (await requestSidecar(ID, '/health')).ok
    })
    expect(await liveVersion()).toBe('0.1.0')
  })

  it('reports health for a running sidecar and drops it after stop', async () => {
    await start(await installVersion('0.1.0'))
    const h = healthAll()[ID]
    expect(h).toBeDefined()
    expect(h?.running).toBe(true)
    expect(h?.breakerOpen).toBe(false)
    expect(h?.version).toBe('0.1.0')
    expect(h?.port).toBe(portOf(ID))

    await stop(ID)
    expect(healthAll()[ID]).toBeUndefined()
  })

  it('stop() kills the process', async () => {
    await start(await installVersion('0.1.0'))
    const port = portOf(ID)
    await stop(ID)
    expect(portOf(ID)).toBe(null)
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow()
  })
})
