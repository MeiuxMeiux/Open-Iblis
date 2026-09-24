// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginManifest } from '@iblis/plugin-sdk'
import { install } from '../electron/main/plugins/registry'
import { launch } from '../electron/main/sidecar/instance'

// A sidecar that dies on launch (missing DLL in the field; here a stub that
// exits immediately) must fail FAST — racing the child's exit against the health
// poll — instead of polling a dead port until the full health timeout elapses.

const ID = 'mx.iblis.processor.echo'
// Exits before it ever binds the port, so /health can never succeed.
const CRASH_SRC = Buffer.from('process.exit(1)\n')

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

let server: Server
let baseUrl = ''
let root = ''

function manifest(healthTimeoutMs: number): PluginManifest {
  return {
    id: ID,
    name: 'Crashing stub',
    version: '0.1.0',
    kind: 'processor',
    hostMinVersion: '0.0.0',
    capabilities: ['echo'],
    assets: [
      {
        path: 'crash.cjs',
        sha256: sha256(CRASH_SRC),
        bytes: CRASH_SRC.length,
        sources: [{ kind: 'gcs', url: `${baseUrl}/crash.cjs` }]
      }
    ],
    executable: { bin: 'crash.cjs', healthPath: '/health', healthTimeoutMs },
    license: 'MIT',
    author: { name: 'Meiux Meiux LLC' }
  }
}

beforeEach(async () => {
  server = createServer((req, res) => {
    if (req.url === '/crash.cjs') return void res.end(CRASH_SRC)
    res.statusCode = 404
    res.end('nope')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  root = mkdtempSync(join(tmpdir(), 'iblis-launch-'))
  process.env.IBLIS_PLUGINS_DIR = root
})

afterEach(async () => {
  delete process.env.IBLIS_PLUGINS_DIR
  rmSync(root, { recursive: true, force: true })
  await new Promise<void>((r) => server.close(() => r()))
})

describe('launch fast-fail', () => {
  it('rejects as soon as the child exits, not at the health timeout', async () => {
    // A generous health timeout: if we waited it out the test would take ~30s.
    const m = manifest(30_000)
    await install(m)

    const t0 = Date.now()
    await expect(launch(m)).rejects.toThrow(/exited before healthy/)
    // The crash is detected in well under the timeout (process exit + a poll tick).
    expect(Date.now() - t0).toBeLessThan(5_000)
  })
})
