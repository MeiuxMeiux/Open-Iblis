// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Catalog, ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
import type { InstalledPlugin } from '../../../shared/contract'

// Pure helpers that merge the signed catalog with on-disk install state into
// the rows the Plugins view renders. Kept framework-free so they unit-test
// without a renderer.

export interface PluginRow {
  id: string
  name: string
  kind: string
  latest: string // highest version offered by the catalog
  activeVersion: string | null
  installedVersions: string[]
  analysisCapabilities: ProcessorAnalysisCapability[]
}

// Minimal x.y.z(-pre) compare; mirrors the host-side ordering.
export function compareSemver(a: string, b: string): number {
  const coreA = (a.split('-', 1)[0] ?? a).split('.').map(Number)
  const coreB = (b.split('-', 1)[0] ?? b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (coreA[i] ?? 0) - (coreB[i] ?? 0)
    if (d !== 0) return d
  }
  const preA = a.includes('-')
  const preB = b.includes('-')
  if (preA !== preB) return preA ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

export function buildRows(catalog: Catalog, installed: InstalledPlugin[]): PluginRow[] {
  const byId = new Map(installed.map((p) => [p.id, p]))
  const latest = new Map<
    string,
    {
      name: string
      kind: string
      version: string
      analysisCapabilities: ProcessorAnalysisCapability[]
    }
  >()
  for (const { manifest: m } of catalog.plugins) {
    const cur = latest.get(m.id)
    if (!cur || compareSemver(m.version, cur.version) > 0) {
      latest.set(m.id, {
        name: m.name,
        kind: m.kind,
        version: m.version,
        analysisCapabilities: m.capabilities.filter(
          (capability): capability is ProcessorAnalysisCapability =>
            capability === 'bpm-detect' || capability === 'key-detect'
        )
      })
    }
  }

  const ids = new Set([...latest.keys(), ...byId.keys()])
  const rows: PluginRow[] = []
  for (const id of ids) {
    const l = latest.get(id)
    const inst = byId.get(id) ?? null
    rows.push({
      id,
      name: l?.name ?? id,
      kind: l?.kind ?? 'plugin',
      latest: l?.version ?? inst?.activeVersion ?? '',
      activeVersion: inst?.activeVersion ?? null,
      installedVersions: inst?.versions ?? [],
      analysisCapabilities: l?.analysisCapabilities ?? []
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export function isInstalled(row: PluginRow): boolean {
  return row.activeVersion !== null
}

// The catalog offers a version we have not installed yet.
export function isUpdatable(row: PluginRow): boolean {
  return (
    isInstalled(row) &&
    row.latest !== '' &&
    row.latest !== row.activeVersion &&
    !row.installedVersions.includes(row.latest)
  )
}

export function isRollbackable(row: PluginRow): boolean {
  return row.installedVersions.length > 1
}
