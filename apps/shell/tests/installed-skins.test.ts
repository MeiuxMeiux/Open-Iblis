// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readInstalledSkins } from '../electron/main/plugins/installed-skins'

// Lay a skin plugin down on disk in the install layout (version folder +
// manifest.json + current.txt) and assert readInstalledSkins resolves it.

let root = ''

function writePlugin(
  id: string,
  version: string,
  manifest: object,
  files: Record<string, string>
): void {
  const dir = join(root, id, version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  writeFileSync(join(root, id, 'current.txt'), version)
}

const skinManifest = (id: string, version: string, extra: object = {}) => ({
  id,
  name: 'Boodark — Nord',
  version,
  kind: 'skin',
  hostMinVersion: '0.0.0',
  capabilities: [],
  assets: [{ path: 'skin.json', sha256: 'a'.repeat(64), bytes: 1, sources: [] }],
  license: 'UNLICENSED',
  author: { name: 'Meiux Meiux LLC' },
  ...extra
})

const descriptor = (extra: object = {}) =>
  JSON.stringify({
    id: 'mx.iblis.skin.boodark-nord',
    name: 'Boodark — Nord',
    version: '1.0.0',
    extends: 'dark-3d',
    theme: 'dark',
    tokens: { 'color.bg.base': '#1f242c', 'color.accent': '#88c0d0' },
    ...extra
  })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iblis-skins-'))
  process.env.IBLIS_PLUGINS_DIR = root
})
afterEach(() => {
  delete process.env.IBLIS_PLUGINS_DIR
  rmSync(root, { recursive: true, force: true })
})

describe('readInstalledSkins', () => {
  it('resolves a valid skin plugin to its descriptor', () => {
    writePlugin(
      'mx.iblis.skin.boodark-nord',
      '1.0.0',
      skinManifest('mx.iblis.skin.boodark-nord', '1.0.0'),
      {
        'skin.json': descriptor()
      }
    )
    const skins = readInstalledSkins()
    expect(skins).toHaveLength(1)
    expect(skins[0]).toMatchObject({
      id: 'mx.iblis.skin.boodark-nord',
      name: 'Boodark — Nord',
      version: '1.0.0',
      theme: 'dark',
      extends: 'dark-3d',
      tokens: { 'color.bg.base': '#1f242c', 'color.accent': '#88c0d0' }
    })
  })

  it('ignores non-skin plugins', () => {
    writePlugin(
      'mx.iblis.processor.echo',
      '0.1.0',
      { ...skinManifest('mx.iblis.processor.echo', '0.1.0'), kind: 'processor' },
      {}
    )
    expect(readInstalledSkins()).toEqual([])
  })

  it('reads + sanitises extras.css and strips @import', () => {
    writePlugin('mx.iblis.skin.x', '1.0.0', skinManifest('mx.iblis.skin.x', '1.0.0'), {
      'skin.json': descriptor({ css: 'extras.css' }),
      'extras.css': '@import url(http://evil);\nbody { background: #000; }'
    })
    const skins = readInstalledSkins()
    expect(skins).toHaveLength(1)
    expect(skins[0]?.css).not.toContain('@import')
    expect(skins[0]?.css).toContain('background: #000')
  })

  it('skips a skin whose descriptor is invalid JSON', () => {
    writePlugin('mx.iblis.skin.bad', '1.0.0', skinManifest('mx.iblis.skin.bad', '1.0.0'), {
      'skin.json': '{not json'
    })
    expect(readInstalledSkins()).toEqual([])
  })

  it('skips a skin whose descriptor has no contract tokens', () => {
    writePlugin('mx.iblis.skin.empty', '1.0.0', skinManifest('mx.iblis.skin.empty', '1.0.0'), {
      'skin.json': descriptor({ tokens: { nope: '#000' } })
    })
    expect(readInstalledSkins()).toEqual([])
  })

  it('refuses an extras.css path that escapes the version folder', () => {
    writePlugin('mx.iblis.skin.trav', '1.0.0', skinManifest('mx.iblis.skin.trav', '1.0.0'), {
      'skin.json': descriptor({ css: '../../../../etc/passwd' })
    })
    const skins = readInstalledSkins()
    expect(skins).toHaveLength(1)
    expect(skins[0]?.css).toBeUndefined() // traversal rejected, descriptor still applies
  })
})
