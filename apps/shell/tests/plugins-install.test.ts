// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginManifest } from '@iblis/plugin-sdk'
import type { InstallProgress } from '../shared/contract'
import { install, rollback, remove, listInstalled, status } from '../electron/main/plugins/registry'

// Drives the on-disk host end-to-end against a localhost asset server: install
// two versions, verify the SHA-256 gate and folder layout, roll back, remove.

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

let server: Server
let assets: Record<string, Buffer> = {}
let baseUrl = ''
let root = ''

function manifest(version: string, body: Buffer, hash = sha256(body)): PluginManifest {
  return {
    id: 'mx.iblis.processor.echo',
    name: 'Echo Server',
    version,
    kind: 'processor',
    hostMinVersion: '0.0.0',
    capabilities: ['echo'],
    assets: [
      {
        path: 'echo-server.cjs',
        sha256: hash,
        bytes: body.length,
        sources: [{ kind: 'gcs', url: `${baseUrl}/${version}/echo-server.cjs` }]
      }
    ],
    license: 'MIT',
    author: { name: 'Meiux Meiux LLC' }
  }
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
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
  root = mkdtempSync(join(tmpdir(), 'iblis-plugins-'))
  process.env.IBLIS_PLUGINS_DIR = root
})

afterEach(async () => {
  delete process.env.IBLIS_PLUGINS_DIR
  rmSync(root, { recursive: true, force: true })
  await new Promise<void>((r) => server.close(() => r()))
})

describe('plugin install lifecycle', () => {
  it('installs an asset, verifies its hash, and activates the version', async () => {
    const body = Buffer.from('// echo v0.1.0\n')
    assets['/0.1.0/echo-server.cjs'] = body
    const result = await install(manifest('0.1.0', body))

    expect(result.activeVersion).toBe('0.1.0')
    const installed = join(root, 'mx.iblis.processor.echo', '0.1.0', 'echo-server.cjs')
    expect(existsSync(installed)).toBe(true)
    expect(readFileSync(installed)).toEqual(body)
    expect(readFileSync(join(root, 'mx.iblis.processor.echo', 'current.txt'), 'utf8').trim()).toBe(
      '0.1.0'
    )
  })

  it('reports aggregated install progress across all assets, ending at 100%', async () => {
    // Two assets so the aggregate (overallTotal, assetIndex/Count, the carry of
    // finished bytes into the next asset's events) is actually exercised.
    const a = Buffer.from('// asset A — the bigger one\n'.repeat(40))
    const b = Buffer.from('// asset B\n')
    assets['/0.1.0/a.cjs'] = a
    assets['/0.1.0/b.cjs'] = b
    const m: PluginManifest = {
      id: 'mx.iblis.processor.echo',
      name: 'Echo Server',
      version: '0.1.0',
      kind: 'processor',
      hostMinVersion: '0.0.0',
      capabilities: ['echo'],
      assets: [
        {
          path: 'a.cjs',
          sha256: sha256(a),
          bytes: a.length,
          sources: [{ kind: 'gcs', url: `${baseUrl}/0.1.0/a.cjs` }]
        },
        {
          path: 'b.cjs',
          sha256: sha256(b),
          bytes: b.length,
          sources: [{ kind: 'gcs', url: `${baseUrl}/0.1.0/b.cjs` }]
        }
      ],
      license: 'MIT',
      author: { name: 'Meiux Meiux LLC' }
    }

    const events: InstallProgress[] = []
    await install(m, { onProgress: (p) => events.push(p) })

    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.id === m.id && e.assetCount === 2)).toBe(true)
    // Monotonic overall, never past the declared sum.
    const sum = a.length + b.length
    for (const e of events) {
      expect(e.overallTotal).toBe(sum)
      expect(e.overallReceived).toBeLessThanOrEqual(sum)
      expect(e.percent).toBeGreaterThanOrEqual(0)
      expect(e.percent).toBeLessThanOrEqual(100)
    }
    // Both assets surfaced, and the run finished fully accounted-for.
    expect(new Set(events.map((e) => e.assetIndex))).toEqual(new Set([0, 1]))
    const last = events.at(-1)!
    expect(last.overallReceived).toBe(sum)
    expect(last.percent).toBe(100)
  })

  it('refuses an asset whose bytes do not match the declared sha256', async () => {
    const body = Buffer.from('tampered\n')
    assets['/0.1.0/echo-server.cjs'] = body
    const bad = manifest('0.1.0', body, sha256(Buffer.from('the-real-bytes')))
    await expect(install(bad)).rejects.toThrow(/sha256 mismatch/)
    expect(existsSync(join(root, 'mx.iblis.processor.echo', '0.1.0'))).toBe(false)
  })

  it('replaces a stale unpack staging tree before retrying an install', async () => {
    const body = Buffer.from('// training-style retry\n')
    assets['/0.1.0/echo-server.cjs'] = body
    const stale = join(root, 'mx.iblis.processor.echo', '0.1.0.staging', 'runtime', 'torch', 'lib')
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'stale.dll'), 'stale')

    await install(manifest('0.1.0', body))

    expect(existsSync(join(root, 'mx.iblis.processor.echo', '0.1.0.staging'))).toBe(false)
    expect(readFileSync(join(root, 'mx.iblis.processor.echo', '0.1.0', 'echo-server.cjs'))).toEqual(
      body
    )
  })

  it('installs a second version then rolls back to the previous one', async () => {
    const v1 = Buffer.from('// v0.1.0\n')
    const v2 = Buffer.from('// v0.1.1\n')
    assets['/0.1.0/echo-server.cjs'] = v1
    assets['/0.1.1/echo-server.cjs'] = v2
    await install(manifest('0.1.0', v1))
    const afterUpdate = await install(manifest('0.1.1', v2))
    expect(afterUpdate.activeVersion).toBe('0.1.1')
    expect(afterUpdate.versions).toEqual(['0.1.0', '0.1.1'])

    const afterRollback = rollback('mx.iblis.processor.echo')
    expect(afterRollback.activeVersion).toBe('0.1.0')
    // both versions stay on disk so the user can roll forward again
    expect(afterRollback.versions).toEqual(['0.1.0', '0.1.1'])
  })

  it('prunes old versions on install, keeping the active one and a rollback target', async () => {
    const id = 'mx.iblis.processor.echo'
    for (const v of ['0.1.0', '0.1.1', '0.1.2']) {
      const body = Buffer.from(`// ${v}\n`)
      assets[`/${v}/echo-server.cjs`] = body
      await install(manifest(v, body))
    }
    // Only the active version and the single most recent prior version survive.
    expect(status(id).versions).toEqual(['0.1.1', '0.1.2'])
    expect(status(id).activeVersion).toBe('0.1.2')
    expect(existsSync(join(root, id, '0.1.0'))).toBe(false)

    // Rollback still has a target, and the active version was never deleted.
    expect(rollback(id).activeVersion).toBe('0.1.1')
  })

  it('reuses a byte-identical asset from a prior version instead of re-downloading', async () => {
    const id = 'mx.iblis.processor.echo'
    const body = Buffer.from('// unchanged weights — identical across versions\n')
    assets['/0.1.0/echo-server.cjs'] = body
    await install(manifest('0.1.0', body))

    // v0.1.1 declares the SAME asset (same sha256/bytes) but the server no longer
    // serves it — a 404 on download. Install must still succeed by hardlinking the
    // copy already on disk from 0.1.0.
    delete assets['/0.1.0/echo-server.cjs']
    const result = await install(manifest('0.1.1', body))
    expect(result.activeVersion).toBe('0.1.1')

    const v1 = join(root, id, '0.1.0', 'echo-server.cjs')
    const v2 = join(root, id, '0.1.1', 'echo-server.cjs')
    expect(readFileSync(v2)).toEqual(body)
    // Hardlink = same inode = shared underlying data (no second copy on disk).
    expect(statSync(v2).ino).toBe(statSync(v1).ino)
  })

  it('still downloads an asset that changed, even when a prior version exists', async () => {
    const id = 'mx.iblis.processor.echo'
    const v1body = Buffer.from('// v0.1.0 binary\n')
    const v2body = Buffer.from('// v0.1.1 binary — different bytes\n')
    assets['/0.1.0/echo-server.cjs'] = v1body
    assets['/0.1.1/echo-server.cjs'] = v2body
    await install(manifest('0.1.0', v1body))
    await install(manifest('0.1.1', v2body))

    const v1 = join(root, id, '0.1.0', 'echo-server.cjs')
    const v2 = join(root, id, '0.1.1', 'echo-server.cjs')
    expect(readFileSync(v2)).toEqual(v2body)
    // Different content → genuinely separate files, not a reused link.
    expect(statSync(v2).ino).not.toBe(statSync(v1).ino)
  })

  it('removes a plugin and all its versions', async () => {
    const body = Buffer.from('// v0.1.0\n')
    assets['/0.1.0/echo-server.cjs'] = body
    await install(manifest('0.1.0', body))
    expect(listInstalled()).toHaveLength(1)

    remove('mx.iblis.processor.echo')
    expect(existsSync(join(root, 'mx.iblis.processor.echo'))).toBe(false)
    expect(listInstalled()).toHaveLength(0)
    expect(status('mx.iblis.processor.echo').activeVersion).toBe(null)
  })

  // Audit 2026-09-24 M-SHL1: renderer-supplied ids reach remove/rollback.
  it('refuses a traversal id instead of deleting outside the plugins root', () => {
    const victim = join(root, '..', `victim-${Date.now()}`)
    mkdirSync(victim, { recursive: true })
    writeFileSync(join(victim, 'keep.txt'), 'x')
    for (const id of [
      '..',
      `../${victim.split(/[\\/]/).pop()}`,
      'a/b',
      'C:\\x',
      '.hidden',
      'a..b'
    ]) {
      expect(() => remove(id)).toThrow(/invalid plugin id/)
      expect(() => rollback(id)).toThrow(/invalid plugin id/)
    }
    expect(existsSync(join(victim, 'keep.txt'))).toBe(true)
    rmSync(victim, { recursive: true, force: true })
  })

  it('lists installed plugins even when a stray folder sits in the root', async () => {
    const body = Buffer.from('// v0.1.0\n')
    assets['/0.1.0/echo-server.cjs'] = body
    await install(manifest('0.1.0', body))
    mkdirSync(join(root, 'New folder'))
    expect(listInstalled().map((p) => p.id)).toEqual(['mx.iblis.processor.echo'])
  })
})
