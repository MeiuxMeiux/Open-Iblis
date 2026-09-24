// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLabCatalog } from '../electron/main/catalog/lab-client'

const BODY =
  JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-07-16T00:00:00Z',
    plugins: [
      {
        manifest: {
          id: 'mx.iblis.processor.essentia-lab',
          name: 'Essentia Lab',
          version: '0.0.1',
          kind: 'processor',
          hostMinVersion: '0.2.0',
          capabilities: ['bpm-detect', 'key-detect'],
          executable: { bin: 'essentia.exe' },
          assets: [],
          license: 'AGPL-3.0-only',
          author: { name: 'Essentia' },
          evaluation: {
            status: 'evaluation-only',
            distribution: 'private-lab',
            codeLicense: 'AGPL-3.0-only',
            dependencyLicenses: ['AGPL-3.0-only'],
            termsUrl: 'https://example.test/essentia-terms',
            noticePath: 'NOTICE.txt',
            upstreamRevision: 'pinned-revision',
            acknowledgement: 'Enable only for private evaluation.',
            releaseBlocker: 'Rights review pending.'
          }
        }
      }
    ]
  }) + '\n'

function signedCatalog(): { pub: string; signature: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    signature: sign(null, Buffer.from(BODY), privateKey).toString('base64')
  }
}

async function serve(signature: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.headers['x-iblis-lease'] !== 'lab-lease') {
      res.statusCode = 401
      res.end('missing lease')
      return
    }
    if (req.url === '/catalog.json') res.end(BODY)
    else if (req.url === '/catalog.json.sig') res.end(signature)
    else {
      res.statusCode = 404
      res.end('not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('private processor lab catalog', () => {
  let cacheDir = ''

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'iblis-lab-catalog-cache-'))
    process.env.IBLIS_CATALOG_CACHE_DIR = cacheDir
  })

  afterEach(() => {
    delete process.env.IBLIS_CATALOG_CACHE_DIR
    delete process.env.IBLIS_LAB_CATALOG_BASE
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('requires both a lab-enabled build and a labs entitlement before fetch', async () => {
    const { pub } = signedCatalog()
    expect((await loadLabCatalog({ lease: 'lab-lease', pubKeyPem: pub })).ok).toBe(false)
    expect((await loadLabCatalog({ enabled: true, pubKeyPem: pub })).ok).toBe(false)
  })

  it('uses its own signed cache namespace and sends the lease only from main', async () => {
    const { pub, signature } = signedCatalog()
    const server = await serve(signature)
    process.env.IBLIS_LAB_CATALOG_BASE = server.base
    try {
      const result = await loadLabCatalog({ enabled: true, lease: 'lab-lease', pubKeyPem: pub })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.plugins[0]?.manifest.evaluation).toMatchObject({
          status: 'evaluation-only',
          distribution: 'private-lab'
        })
      }
    } finally {
      await server.close()
    }
  })
})
