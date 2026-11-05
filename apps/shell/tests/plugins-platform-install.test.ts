// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginManifest, PlatformTarget } from '@iblis/plugin-sdk'
import { install } from '../electron/main/plugins/registry'
import { launch } from '../electron/main/sidecar/instance'

// A multi-platform pack: this host downloads only its own assets and launches
// its own bin. The "other" asset is served too, so a wrong filter would be
// visible on disk rather than as a download error.

const ID = 'mx.iblis.processor.platform'
const HERE = `${process.platform}-${process.arch}` as PlatformTarget
const OTHER: PlatformTarget = HERE === 'linux-arm64' ? 'win32-x64' : 'linux-arm64'
// Exits at once: launch() then fails fast with the bin it actually ran.
const HERE_SRC = Buffer.from('process.exit(3)\n')
const OTHER_SRC = Buffer.from('process.exit(4)\n')

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

let server: Server
let baseUrl = ''
let root = ''

function manifest(): PluginManifest {
  return {
    id: ID,
    name: 'Platform stub',
    version: '0.1.0',
    kind: 'processor',
    hostMinVersion: '0.0.0',
    platforms: [HERE, OTHER],
    capabilities: ['echo'],
    assets: [
      {
        path: 'here.cjs',
        sha256: sha256(HERE_SRC),
        bytes: HERE_SRC.length,
        platforms: [HERE],
        sources: [{ kind: 'gcs', url: `${baseUrl}/here.cjs` }]
      },
      {
        path: 'other.cjs',
        sha256: sha256(OTHER_SRC),
        bytes: OTHER_SRC.length,
        platforms: [OTHER],
        sources: [{ kind: 'gcs', url: `${baseUrl}/other.cjs` }]
      }
    ],
    executable: {
      bin: 'other.cjs',
      healthTimeoutMs: 30_000,
      platforms: [{ platforms: [HERE], bin: 'here.cjs' }]
    },
    license: 'MIT',
    author: { name: 'Meiux Meiux LLC' }
  }
}

beforeEach(async () => {
  server = createServer((req, res) => {
    if (req.url === '/here.cjs') return void res.end(HERE_SRC)
    if (req.url === '/other.cjs') return void res.end(OTHER_SRC)
    res.statusCode = 404
    res.end('nope')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  root = mkdtempSync(join(tmpdir(), 'iblis-platform-'))
  process.env.IBLIS_PLUGINS_DIR = root
})

afterEach(async () => {
  delete process.env.IBLIS_PLUGINS_DIR
  rmSync(root, { recursive: true, force: true })
  await new Promise<void>((r) => server.close(() => r()))
})

describe('multi-platform pack', () => {
  it("downloads only this host's assets and launches this host's bin", async () => {
    const m = manifest()
    await install(m)
    const dir = join(root, ID, '0.1.0')
    expect(existsSync(join(dir, 'here.cjs'))).toBe(true)
    expect(existsSync(join(dir, 'other.cjs'))).toBe(false)
    // here.cjs exits 3; other.cjs would be missing (ENOENT) or exit 4.
    await expect(launch(m)).rejects.toThrow('code=3')
  })
})
