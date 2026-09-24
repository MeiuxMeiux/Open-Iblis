// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { parseManifest, type PluginManifest } from '../src/index.js'

const SHA = 'a'.repeat(64)

const valid: PluginManifest = {
  id: 'mx.iblis.engine.acestep',
  name: 'ACE-Step',
  version: '1.5.0',
  kind: 'engine',
  hostMinVersion: '0.1.0',
  capabilities: ['text-to-music'],
  assets: [
    {
      path: 'bin/ace-server.exe',
      sha256: SHA,
      bytes: 1024,
      sources: [
        { kind: 'vendor', url: 'https://huggingface.co/x/y' },
        { kind: 'gcs', url: 'https://storage.googleapis.com/iblis-dist/x' }
      ],
      executable: true
    }
  ],
  executable: { bin: 'bin/ace-server.exe', healthPath: '/health' },
  presets: [{ id: 'fast', name: 'Fast', minVramMb: 4000 }],
  license: 'MIT',
  author: { name: 'Meiux Meiux LLC', url: 'https://iblis.meiuxmeiux.com' }
}

const evaluation = {
  status: 'commercial-candidate' as const,
  distribution: 'public-catalog' as const,
  codeLicense: 'MIT',
  dependencyLicenses: ['MIT'],
  termsUrl: 'https://example.test/terms',
  noticePath: 'NOTICE.txt',
  upstreamRevision: 'abc123',
  acknowledgement: 'I understand this provider is under review.'
}

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const r = parseManifest(valid)
    expect(r.ok).toBe(true)
  })

  it('rejects a non-object', () => {
    const r = parseManifest(null)
    expect(r.ok).toBe(false)
  })

  it('rejects a bad reverse-DNS id', () => {
    const r = parseManifest({ ...valid, id: 'acestep' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('.id'))).toBe(true)
  })

  it('rejects an unknown kind', () => {
    const r = parseManifest({ ...valid, kind: 'wizard' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('.kind'))).toBe(true)
  })

  it('rejects a non-SemVer version', () => {
    const r = parseManifest({ ...valid, version: '1.5' })
    expect(r.ok).toBe(false)
  })

  it('rejects a malformed sha256', () => {
    const bad = { ...valid, assets: [{ ...valid.assets[0], sha256: 'xyz' }] }
    const r = parseManifest(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('sha256'))).toBe(true)
  })

  it('rejects a non-https asset source', () => {
    const bad = {
      ...valid,
      assets: [{ ...valid.assets[0], sources: [{ kind: 'vendor', url: 'http://x/y' }] }]
    }
    const r = parseManifest(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('url'))).toBe(true)
  })

  it('rejects an empty sources array', () => {
    const bad = { ...valid, assets: [{ ...valid.assets[0], sources: [] }] }
    const r = parseManifest(bad)
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown slot id', () => {
    const bad = { ...valid, slots: [{ slot: 'nope.slot', entry: 'X.svelte' }] }
    const r = parseManifest(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('slot'))).toBe(true)
  })

  it('accumulates multiple errors', () => {
    const r = parseManifest({ ...valid, id: 'x', version: 'nope', kind: 'bad' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['parent escape', '../../etc/evil'],
    ['nested parent escape', 'sub/../../evil'],
    ['posix absolute', '/etc/evil'],
    ['windows drive', 'C:\\evil.exe'],
    ['backslash separator', 'sub\\evil'],
    ['nul byte', 'evil\0.gguf']
  ])('rejects a traversing asset.path (%s)', (_label, path) => {
    const bad = { ...valid, assets: [{ ...valid.assets[0], path }] }
    const r = parseManifest(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('.path'))).toBe(true)
  })

  it('rejects a traversing executable.bin', () => {
    const bad = { ...valid, executable: { bin: '../../../usr/bin/sh', healthPath: '/health' } }
    const r = parseManifest(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('.bin'))).toBe(true)
  })

  it('rejects a traversing slot.entry', () => {
    const bad = { ...valid, slots: [{ slot: 'nope.slot', entry: '../../evil.svelte' }] }
    const r = parseManifest(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('.entry'))).toBe(true)
  })

  it('still accepts an ordinary nested relative asset.path', () => {
    const ok = { ...valid, assets: [{ ...valid.assets[0], path: 'bin/sub/ace-server.exe' }] }
    expect(parseManifest(ok).ok).toBe(true)
  })

  it('requires a closed evaluation declaration for BPM/key processors', () => {
    const analysis = { ...valid, kind: 'processor' as const, capabilities: ['bpm-detect'] }
    expect(parseManifest(analysis).ok).toBe(false)
    expect(parseManifest({ ...analysis, evaluation }).ok).toBe(true)
    expect(parseManifest({ ...analysis, evaluation: { ...evaluation, extra: 'nope' } }).ok).toBe(
      false
    )
  })

  describe('engine contract v2 section', () => {
    const v2 = {
      ...valid,
      assets: [
        ...valid.assets,
        {
          path: 'engine.v2.json',
          sha256: SHA,
          bytes: 512,
          sources: [{ kind: 'gcs' as const, url: 'https://storage.googleapis.com/iblis-dist/d' }]
        }
      ],
      engine: {
        protocolVersion: 2 as const,
        descriptorAsset: 'engine.v2.json',
        execution: 'local-sidecar' as const
      }
    }

    it('accepts a well-formed v2 engine section', () => {
      expect(parseManifest(v2).ok).toBe(true)
      expect(
        parseManifest({ ...v2, engine: { ...v2.engine, adapterIngress: 'iblis-root-v1' } }).ok
      ).toBe(true)
    })

    it('is a closed shape: unknown fields, protocols, and executions fail', () => {
      expect(parseManifest({ ...v2, engine: { ...v2.engine, smuggled: true } }).ok).toBe(false)
      expect(parseManifest({ ...v2, engine: { ...v2.engine, protocolVersion: 3 } }).ok).toBe(false)
      expect(parseManifest({ ...v2, engine: { ...v2.engine, execution: 'remote' } }).ok).toBe(false)
      expect(
        parseManifest({ ...v2, engine: { ...v2.engine, adapterIngress: 'anything-else' } }).ok
      ).toBe(false)
    })

    it('requires the descriptor to be a declared, contained asset', () => {
      expect(
        parseManifest({ ...v2, engine: { ...v2.engine, descriptorAsset: 'missing.json' } }).ok
      ).toBe(false)
      expect(
        parseManifest({ ...v2, engine: { ...v2.engine, descriptorAsset: '../escape.json' } }).ok
      ).toBe(false)
    })

    it('is only allowed on engine plugins', () => {
      const processor = { ...v2, kind: 'processor' as const, evaluation: undefined }
      delete (processor as { evaluation?: unknown }).evaluation
      const r = parseManifest(processor)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.some((e) => e.includes('engine plugins'))).toBe(true)
    })
  })
})
