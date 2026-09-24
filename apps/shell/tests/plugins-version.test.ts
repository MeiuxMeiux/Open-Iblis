// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { Catalog } from '@iblis/plugin-sdk'
import type { InstalledPlugin } from '../shared/contract'
import {
  buildRows,
  compareSemver,
  isInstalled,
  isRollbackable,
  isUpdatable
} from '../src/lib/plugins/version'

// Pure merge logic behind the Plugins view — verifiable without a renderer.

function catalog(...versions: string[]): Catalog {
  return {
    schemaVersion: 1,
    generatedAt: '2026-06-05T00:00:00Z',
    plugins: versions.map((version) => ({
      manifest: {
        id: 'mx.iblis.processor.echo',
        name: 'Echo Server',
        version,
        kind: 'processor',
        hostMinVersion: '0.0.0',
        capabilities: ['echo'],
        assets: [],
        license: 'MIT',
        author: { name: 'Meiux Meiux LLC' }
      },
      channel: 'stable'
    }))
  }
}

function installed(activeVersion: string | null, versions: string[]): InstalledPlugin[] {
  return [{ id: 'mx.iblis.processor.echo', activeVersion, versions }]
}

describe('compareSemver', () => {
  it('orders by core version and ranks release above prerelease', () => {
    expect(compareSemver('0.1.0', '0.1.1')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
  })
})

describe('buildRows', () => {
  it('picks the highest catalog version as latest', () => {
    const rows = buildRows(catalog('0.1.0', '0.1.1'), [])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.latest).toBe('0.1.1')
    expect(isInstalled(rows[0]!)).toBe(false)
  })

  it('flags an update when the catalog offers an uninstalled version', () => {
    const [row] = buildRows(catalog('0.1.1'), installed('0.1.0', ['0.1.0']))
    expect(isInstalled(row!)).toBe(true)
    expect(isUpdatable(row!)).toBe(true)
    expect(isRollbackable(row!)).toBe(false)
  })

  it('flags rollback once two versions are on disk, and no update when latest is active', () => {
    const [row] = buildRows(catalog('0.1.1'), installed('0.1.1', ['0.1.0', '0.1.1']))
    expect(isUpdatable(row!)).toBe(false)
    expect(isRollbackable(row!)).toBe(true)
  })

  it('still lists a plugin that is installed but no longer in the catalog', () => {
    const [row] = buildRows(
      { schemaVersion: 1, generatedAt: '', plugins: [] },
      installed('0.1.0', ['0.1.0'])
    )
    expect(row?.name).toBe('mx.iblis.processor.echo')
    expect(isInstalled(row!)).toBe(true)
  })
})
