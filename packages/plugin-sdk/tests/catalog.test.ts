// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { parseCatalog, parseLabCatalog } from '../src/index.js'

const SHA = 'b'.repeat(64)

const entry = {
  manifest: {
    id: 'mx.iblis.skin.infernal',
    name: 'Infernal',
    version: '1.0.0',
    kind: 'skin',
    hostMinVersion: '0.1.0',
    capabilities: [],
    assets: [
      {
        path: 'skin.json',
        sha256: SHA,
        bytes: 512,
        sources: [{ kind: 'gcs', url: 'https://storage.googleapis.com/iblis-dist/skins/x' }]
      }
    ],
    license: 'UNLICENSED',
    author: { name: 'Meiux Meiux LLC' }
  },
  channel: 'stable',
  publishedAt: '2026-06-03T00:00:00Z'
}

describe('parseCatalog', () => {
  it('accepts an empty catalog (matches the scaffold file)', () => {
    const r = parseCatalog({ schemaVersion: 1, generatedAt: '2026-05-14T00:00:00Z', plugins: [] })
    expect(r.ok).toBe(true)
  })

  it('accepts a catalog with a valid entry', () => {
    const r = parseCatalog({
      schemaVersion: 1,
      generatedAt: '2026-06-03T00:00:00Z',
      plugins: [entry]
    })
    expect(r.ok).toBe(true)
  })

  it('keeps restricted processor metadata out of public catalogs but accepts it in lab catalogs', () => {
    const manifest = {
      id: 'mx.iblis.processor.lab',
      name: 'Lab processor',
      version: '1.0.0',
      kind: 'processor',
      hostMinVersion: '0.2.0',
      capabilities: ['bpm-detect'],
      assets: [],
      executable: { bin: 'lab.exe' },
      license: 'MIT',
      author: { name: 'Iblis' },
      evaluation: {
        status: 'evaluation-only',
        distribution: 'private-lab',
        codeLicense: 'AGPL-3.0-only',
        dependencyLicenses: ['AGPL-3.0-only'],
        termsUrl: 'https://example.test/terms',
        noticePath: 'NOTICE.txt',
        upstreamRevision: 'deadbeef',
        acknowledgement: 'Private evaluation only.',
        releaseBlocker: 'Rights review pending.'
      }
    }
    const catalog = {
      schemaVersion: 1,
      generatedAt: '2026-07-16T00:00:00Z',
      plugins: [{ manifest }]
    }
    expect(parseCatalog(catalog).ok).toBe(false)
    expect(parseLabCatalog(catalog).ok).toBe(true)
  })

  it('rejects a wrong schemaVersion', () => {
    const r = parseCatalog({ schemaVersion: 2, generatedAt: 'x', plugins: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true)
  })

  it('surfaces nested manifest errors with an indexed path', () => {
    const bad = {
      schemaVersion: 1,
      generatedAt: 'x',
      plugins: [{ manifest: { ...entry.manifest, id: 'oops' } }]
    }
    const r = parseCatalog(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('plugins[0].manifest.id'))).toBe(true)
  })

  it('rejects a bad channel', () => {
    const r = parseCatalog({
      schemaVersion: 1,
      generatedAt: 'x',
      plugins: [{ ...entry, channel: 'nightly' }]
    })
    expect(r.ok).toBe(false)
  })
})
