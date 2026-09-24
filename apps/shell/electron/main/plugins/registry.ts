// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { rmSync, existsSync, readdirSync } from 'node:fs'
import type { PluginManifest } from '@iblis/plugin-sdk'
import type { InstalledPlugin } from '../../../shared/contract'
import { isSafeSegment, pluginDir, pluginsRoot } from './paths'
import { readPointer, writePointer, installedVersions } from './pointer'
import { installManifest, type InstallOptions } from './install'
import { pruneVersions } from './prune'
import { log } from '../logger'
import { assertHostCompatible } from './host-compatibility'
import { readInstalledManifestUnchecked } from './installed-manifest'

// The on-disk plugin registry: install/activate, instant rollback (flip the
// pointer), remove, and report state for the UI. Sidecar lifecycle (spawn/kill
// around these) is layered on in the supervisor.

export function status(id: string): InstalledPlugin {
  return { id, activeVersion: readPointer(id), versions: installedVersions(id) }
}

export async function install(
  manifest: PluginManifest,
  opts?: InstallOptions
): Promise<InstalledPlugin> {
  assertHostCompatible(manifest)
  await installManifest(manifest, opts)
  pruneVersions(manifest.id) // keep active + one rollback target, drop the rest
  return status(manifest.id)
}

// Roll back to the highest-semver installed version that is not active.
export function rollback(id: string): InstalledPlugin {
  const current = readPointer(id)
  const others = installedVersions(id).filter((v) => v !== current)
  const target = others[others.length - 1]
  if (target === undefined) throw new Error(`no other version to roll back to for ${id}`)
  const manifest = readInstalledManifestUnchecked(id, target)
  if (!manifest) throw new Error(`installed manifest is missing or unreadable for ${id}@${target}`)
  assertHostCompatible(manifest)
  writePointer(id, target)
  log('info', 'plugin rolled back', { id, from: current, to: target })
  return status(id)
}

export function remove(id: string): void {
  rmSync(pluginDir(id), { recursive: true, force: true })
  log('info', 'plugin removed', { id })
}

export function listInstalled(): InstalledPlugin[] {
  const root = pluginsRoot()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isSafeSegment(e.name)) // skip stray folders
    .map((e) => status(e.name))
}
