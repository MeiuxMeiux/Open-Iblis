// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  assetsForPlatform,
  effectivePlatforms,
  executableForPlatform,
  isPlatformTarget,
  matchesPlatform,
  parseManifest,
  platformSupportError,
  type PluginAsset,
  type PluginManifest
} from '../src/index.js'

const SHA = 'b'.repeat(64)
const WIN = { os: 'win32', arch: 'x64' }
const MAC_ARM = { os: 'darwin', arch: 'arm64' }
const MAC_X64 = { os: 'darwin', arch: 'x64' }
const LINUX = { os: 'linux', arch: 'x64' }

function asset(path: string, platforms?: PluginAsset['platforms']): PluginAsset {
  return {
    path,
    sha256: SHA,
    bytes: 1,
    sources: [{ kind: 'gcs', url: `https://storage.googleapis.com/iblis-dist/${path}` }],
    executable: !path.endsWith('.gguf'),
    ...(platforms ? { platforms } : {})
  }
}

// The shape the ACE-Step pack takes once it carries a Mac build.
const multi: PluginManifest = {
  id: 'mx.iblis.engine.acestep',
  name: 'ACE-Step 1.5',
  version: '0.2.0',
  kind: 'engine',
  hostMinVersion: '0.2.0-alpha.61',
  platforms: ['win32-x64', 'darwin-arm64'],
  capabilities: ['text-to-music'],
  executable: {
    bin: 'ace-server.exe',
    args: ['--models', '.'],
    platforms: [{ platforms: ['darwin'], bin: 'ace-server' }]
  },
  assets: [
    asset('ace-server.exe', ['win32-x64']),
    asset('ggml-cuda.dll', ['win32-x64']),
    asset('ace-server', ['darwin-arm64']),
    asset('model.gguf')
  ],
  license: 'MIT',
  author: { name: 'Meiux Meiux LLC' }
}

const legacy: PluginManifest = {
  ...multi,
  platforms: undefined,
  executable: { bin: 'ace-server.exe' },
  assets: [asset('ace-server.exe'), asset('model.gguf')]
}
delete legacy.platforms

describe('platform targets', () => {
  it('accepts an OS or an OS-CPU pair, nothing else', () => {
    for (const t of ['win32', 'darwin', 'linux', 'darwin-arm64', 'win32-x64', 'linux-arm64'])
      expect(isPlatformTarget(t)).toBe(true)
    for (const t of ['macos', 'darwin-arm', 'darwin-arm64-x', '', 'x64', 7])
      expect(isPlatformTarget(t)).toBe(false)
  })

  it('matches by OS or by exact pair; absent means everywhere', () => {
    expect(matchesPlatform(undefined, MAC_ARM)).toBe(true)
    expect(matchesPlatform([], MAC_ARM)).toBe(true)
    expect(matchesPlatform(['darwin'], MAC_X64)).toBe(true)
    expect(matchesPlatform(['darwin-arm64'], MAC_X64)).toBe(false)
    expect(matchesPlatform(['win32-x64', 'darwin-arm64'], MAC_ARM)).toBe(true)
  })
})

describe('platform resolution', () => {
  it('downloads only the assets for this host', () => {
    expect(assetsForPlatform(multi, WIN).map((a) => a.path)).toEqual([
      'ace-server.exe',
      'ggml-cuda.dll',
      'model.gguf'
    ])
    expect(assetsForPlatform(multi, MAC_ARM).map((a) => a.path)).toEqual([
      'ace-server',
      'model.gguf'
    ])
  })

  it('applies the first matching executable override and keeps the rest of the spec', () => {
    expect(executableForPlatform(multi.executable!, MAC_ARM)).toEqual({
      bin: 'ace-server',
      args: ['--models', '.']
    })
    expect(executableForPlatform(multi.executable!, WIN)).toEqual({
      bin: 'ace-server.exe',
      args: ['--models', '.']
    })
  })

  it('treats a legacy native pack as Windows x64 only', () => {
    expect(effectivePlatforms(legacy)).toEqual(['win32-x64'])
    expect(platformSupportError(legacy, WIN)).toBeNull()
    expect(platformSupportError(legacy, MAC_ARM)).toBe(
      'ACE-Step 1.5 0.2.0 is available for Windows x64 only; this computer is macOS (Apple Silicon).'
    )
  })

  it('lets Node-script sidecars and sidecar-less plugins run anywhere', () => {
    const script = { ...legacy, executable: { bin: 'server.cjs' } }
    expect(effectivePlatforms(script)).toBeUndefined()
    const skin = { ...legacy, kind: 'skin' as const }
    delete skin.executable
    expect(platformSupportError(skin, LINUX)).toBeNull()
  })

  it('refuses a Mac Intel host when only Apple Silicon is declared', () => {
    expect(platformSupportError(multi, MAC_X64)).toMatch(
      /Windows x64, macOS \(Apple Silicon\) only/
    )
  })
})

describe('parseManifest with platform fields', () => {
  it('accepts the multi-platform engine shape', () => {
    expect(parseManifest(multi)).toEqual({ ok: true, value: multi })
  })

  it('rejects unknown targets and empty or duplicate lists', () => {
    for (const platforms of [['macos'], [], ['darwin', 'darwin']]) {
      const r = parseManifest({ ...multi, platforms })
      expect(r.ok).toBe(false)
    }
    const r = parseManifest({ ...multi, assets: [{ ...asset('x.bin'), platforms: 'darwin' }] })
    expect(r.ok).toBe(false)
  })

  it('rejects an override bin that escapes the plugin folder or an unknown override field', () => {
    const bad = {
      ...multi,
      executable: { bin: 'a.exe', platforms: [{ platforms: ['darwin'], bin: '../x' }] }
    }
    expect(parseManifest(bad).ok).toBe(false)
    const extra = {
      ...multi,
      executable: { bin: 'a.exe', platforms: [{ platforms: ['darwin'], env: {} }] }
    }
    expect(parseManifest(extra).ok).toBe(false)
  })

  it('rejects a manifest whose bin is not downloaded on a host it supports', () => {
    const missing = {
      ...multi,
      assets: multi.assets.filter((a) => a.path !== 'ace-server')
    }
    const r = parseManifest(missing)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/darwin-arm64 the bin "ace-server"/)
  })

  it('leaves legacy manifests untouched by the consistency check', () => {
    expect(parseManifest(legacy).ok).toBe(true)
  })
})
