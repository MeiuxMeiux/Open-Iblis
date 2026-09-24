// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from 'electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginManifest } from '@iblis/plugin-sdk'

const mocks = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('../electron/main/generation-queue', () => ({ acquireEngineMutation: vi.fn() }))
vi.mock('../electron/main/processors', () => ({ acquireProcessorMutation: vi.fn() }))
vi.mock('../electron/main/sidecar/supervisor', () => ({
  start: mocks.start,
  hotSwap: vi.fn(),
  stop: vi.fn()
}))

import { assertHostCompatible } from '../electron/main/plugins/host-compatibility'
import { compareSemver } from '../electron/main/plugins/semver'
import { install, rollback } from '../electron/main/plugins/registry'
import { startInstalledSidecars } from '../electron/main/plugins/lifecycle'
import { readInstalledManifest } from '../electron/main/plugins/installed-manifest'

const testApp = app as unknown as { isPackaged: boolean; getVersion: () => string }
const originalPackaged = testApp.isPackaged
const originalVersion = testApp.getVersion
let root = ''

function manifest(version: string, hostMinVersion: string): PluginManifest {
  return {
    id: 'mx.iblis.engine.test',
    name: 'Test engine',
    version,
    kind: 'engine',
    hostMinVersion,
    capabilities: ['text-to-music'],
    executable: { bin: 'engine.exe', args: [] },
    assets: [],
    license: 'MIT',
    author: { name: 'Meiux Meiux LLC' }
  }
}

function writeInstalled(value: PluginManifest, active = false): void {
  const dir = join(root, value.id, value.version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(value))
  if (active) writeFileSync(join(root, value.id, 'current.txt'), `${value.version}\n`)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iblis-host-version-'))
  process.env.IBLIS_PLUGINS_DIR = root
  testApp.isPackaged = true
  testApp.getVersion = () => '0.2.0-alpha.37'
  mocks.start.mockReset()
})

afterEach(() => {
  testApp.isPackaged = originalPackaged
  testApp.getVersion = originalVersion
  delete process.env.IBLIS_PLUGINS_DIR
  rmSync(root, { recursive: true, force: true })
})

describe('host version precedence', () => {
  it('orders numeric prerelease identifiers as SemVer requires', () => {
    expect(compareSemver('0.2.0-alpha.9', '0.2.0-alpha.10')).toBeLessThan(0)
    expect(compareSemver('0.2.0-alpha.37', '0.2.0-alpha.37+build.5')).toBe(0)
    expect(compareSemver('0.2.0', '0.2.0-alpha.99')).toBeGreaterThan(0)
  })

  it('returns a precise old-host error', () => {
    expect(() =>
      assertHostCompatible(manifest('1.0.0', '0.2.0-alpha.38'), {
        version: '0.2.0-alpha.37',
        enforce: true
      })
    ).toThrow('requires Iblis 0.2.0-alpha.38 or newer; this host is 0.2.0-alpha.37')
  })
})

describe('host minimum lifecycle enforcement', () => {
  it('refuses install before writing or activating incompatible bytes', async () => {
    await expect(install(manifest('1.0.0', '0.2.0-alpha.38'))).rejects.toThrow(
      'requires Iblis 0.2.0-alpha.38 or newer'
    )
    expect(existsSync(join(root, 'mx.iblis.engine.test'))).toBe(false)
  })

  it('refuses an incompatible rollback without changing the active pointer', () => {
    writeInstalled(manifest('1.0.0', '0.2.0-alpha.38'))
    writeInstalled(manifest('1.1.0', '0.2.0-alpha.37'), true)

    expect(() => rollback('mx.iblis.engine.test')).toThrow('requires Iblis 0.2.0-alpha.38 or newer')
    expect(readFileSync(join(root, 'mx.iblis.engine.test', 'current.txt'), 'utf8').trim()).toBe(
      '1.1.0'
    )
  })

  it('skips an incompatible active sidecar at boot', async () => {
    writeInstalled(manifest('1.0.0', '0.2.0-alpha.38'), true)
    expect(readInstalledManifest('mx.iblis.engine.test', '1.0.0')).toBeNull()
    await startInstalledSidecars()
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
