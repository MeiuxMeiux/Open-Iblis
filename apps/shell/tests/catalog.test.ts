// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCatalog } from '../electron/main/catalog/client'

// Exercises the real fetch -> verify -> parse path against a localhost server,
// signing with an ephemeral key injected via loadCatalog({ pubKeyPem }) so the
// test never needs the production private key.

const CATALOG =
  JSON.stringify({ schemaVersion: 1, generatedAt: '2026-06-05T00:00:00Z', plugins: [] }, null, 2) +
  '\n'

const CLOUD_CATALOG =
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: '2026-07-16T00:00:00Z',
      plugins: [
        {
          manifest: {
            id: 'mx.iblis.cloud.openrouter',
            name: 'OpenRouter Cloud Provider',
            version: '0.1.0',
            kind: 'cloud-provider',
            hostMinVersion: '0.2.0-alpha.34',
            capabilities: ['song-ideas'],
            cloudProvider: { id: 'openrouter' },
            assets: [],
            license: 'UNLICENSED',
            author: { name: 'Meiux Meiux LLC' }
          },
          channel: 'beta'
        }
      ]
    },
    null,
    2
  ) + '\n'

function ed25519(): {
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
  pub: string
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privateKey, pub: publicKey.export({ type: 'spki', format: 'pem' }) as string }
}

function signB64(body: string, key: Parameters<typeof sign>[2]): string {
  return sign(null, Buffer.from(body), key).toString('base64')
}

async function serve(
  files: Record<string, string>
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const body = files[req.url ?? '']
    if (body === undefined) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.end(body)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r()))
  }
}

describe('catalog client', () => {
  let cacheDir = ''

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'iblis-catalog-cache-'))
    process.env.IBLIS_CATALOG_CACHE_DIR = cacheDir
  })

  afterEach(() => {
    delete process.env.IBLIS_CATALOG_BASE
    delete process.env.IBLIS_CATALOG_CACHE_DIR
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('verifies a good signature and returns the parsed catalog', async () => {
    const { privateKey, pub } = ed25519()
    const srv = await serve({
      '/catalog.json': CATALOG,
      '/catalog.json.sig': signB64(CATALOG, privateKey)
    })
    process.env.IBLIS_CATALOG_BASE = srv.base
    try {
      const res = await loadCatalog({ pubKeyPem: pub })
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.data.schemaVersion).toBe(1)
    } finally {
      await srv.close()
    }
  })

  it('uses the v2 route for declarative cloud adapters without touching v1', async () => {
    const { privateKey, pub } = ed25519()
    const srv = await serve({
      '/api/v1/catalog.json': CATALOG,
      '/api/v1/catalog.json.sig': signB64(CATALOG, privateKey),
      '/api/v2/catalog.json': CLOUD_CATALOG,
      '/api/v2/catalog.json.sig': signB64(CLOUD_CATALOG, privateKey)
    })
    process.env.IBLIS_CATALOG_BASE = `${srv.base}/api/v2`
    try {
      const res = await loadCatalog({ pubKeyPem: pub })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.data.plugins).toHaveLength(1)
        expect(res.data.plugins[0]?.manifest).toMatchObject({
          id: 'mx.iblis.cloud.openrouter',
          kind: 'cloud-provider',
          cloudProvider: { id: 'openrouter' }
        })
      }
    } finally {
      await srv.close()
    }
  })

  it('can validate the legacy v1 route separately during the transition', async () => {
    const { privateKey, pub } = ed25519()
    const srv = await serve({
      '/api/v1/catalog.json': CATALOG,
      '/api/v1/catalog.json.sig': signB64(CATALOG, privateKey),
      '/api/v2/catalog.json': CLOUD_CATALOG,
      '/api/v2/catalog.json.sig': signB64(CLOUD_CATALOG, privateKey)
    })
    process.env.IBLIS_CATALOG_BASE = `${srv.base}/api/v1`
    try {
      const res = await loadCatalog({ pubKeyPem: pub, route: 'v1' })
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.data.plugins).toHaveLength(0)
    } finally {
      await srv.close()
    }
  })

  it('rejects a catalog whose bytes were tampered after signing', async () => {
    const { privateKey, pub } = ed25519()
    const tampered = CATALOG.replace('"plugins": []', '"plugins": [ ]')
    const srv = await serve({
      '/catalog.json': tampered,
      '/catalog.json.sig': signB64(CATALOG, privateKey)
    })
    process.env.IBLIS_CATALOG_BASE = srv.base
    try {
      const res = await loadCatalog({ pubKeyPem: pub })
      expect(res.ok).toBe(false)
    } finally {
      await srv.close()
    }
  })

  it('rejects a catalog signed by a different key', async () => {
    const signer = ed25519()
    const other = ed25519()
    const srv = await serve({
      '/catalog.json': CATALOG,
      '/catalog.json.sig': signB64(CATALOG, signer.privateKey)
    })
    process.env.IBLIS_CATALOG_BASE = srv.base
    try {
      const res = await loadCatalog({ pubKeyPem: other.pub })
      expect(res.ok).toBe(false)
    } finally {
      await srv.close()
    }
  })

  it('surfaces a fetch failure as an error result', async () => {
    process.env.IBLIS_CATALOG_BASE = 'http://127.0.0.1:1' // nothing listening
    const res = await loadCatalog()
    expect(res.ok).toBe(false)
  })

  it('falls back to the last verified catalog when the network is down', async () => {
    const { privateKey, pub } = ed25519()
    const srv = await serve({
      '/catalog.json': CATALOG,
      '/catalog.json.sig': signB64(CATALOG, privateKey)
    })
    // First load succeeds and caches the verified bytes.
    process.env.IBLIS_CATALOG_BASE = srv.base
    expect((await loadCatalog({ pubKeyPem: pub })).ok).toBe(true)
    await srv.close()

    // Now the feed is unreachable — the cached catalog should still serve.
    process.env.IBLIS_CATALOG_BASE = 'http://127.0.0.1:1'
    const offline = await loadCatalog({ pubKeyPem: pub })
    expect(offline.ok).toBe(true)
    if (offline.ok) expect(offline.data.schemaVersion).toBe(1)
  })

  it("does not use alpha.33's v1 cache when the v2 route is offline", async () => {
    const { writeFileSync } = await import('node:fs')
    const { privateKey, pub } = ed25519()
    // alpha.33 stored its verified pair under catalog.{json,sig}; v2 has a
    // distinct key and must not silently treat that legacy route as current.
    writeFileSync(join(cacheDir, 'catalog.json'), CATALOG)
    writeFileSync(join(cacheDir, 'catalog.json.sig'), signB64(CATALOG, privateKey))
    process.env.IBLIS_CATALOG_BASE = 'http://127.0.0.1:1'
    const missingV2 = await loadCatalog({ pubKeyPem: pub })
    expect(missingV2.ok).toBe(false)

    const srv = await serve({
      '/catalog.json': CLOUD_CATALOG,
      '/catalog.json.sig': signB64(CLOUD_CATALOG, privateKey)
    })
    process.env.IBLIS_CATALOG_BASE = srv.base
    expect((await loadCatalog({ pubKeyPem: pub })).ok).toBe(true)
    await srv.close()

    process.env.IBLIS_CATALOG_BASE = 'http://127.0.0.1:1'
    const cachedV2 = await loadCatalog({ pubKeyPem: pub })
    expect(cachedV2.ok).toBe(true)
  })

  it('rejects a cached catalog that fails verification under a different key', async () => {
    const signer = ed25519()
    const other = ed25519()
    const srv = await serve({
      '/catalog.json': CATALOG,
      '/catalog.json.sig': signB64(CATALOG, signer.privateKey)
    })
    // Cache it as valid under the signer's key.
    process.env.IBLIS_CATALOG_BASE = srv.base
    expect((await loadCatalog({ pubKeyPem: signer.pub })).ok).toBe(true)
    await srv.close()

    // Offline, but now verifying with a different key — the cache must not be trusted.
    process.env.IBLIS_CATALOG_BASE = 'http://127.0.0.1:1'
    const res = await loadCatalog({ pubKeyPem: other.pub })
    expect(res.ok).toBe(false)
  })
})
