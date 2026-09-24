// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginManifest } from '@iblis/plugin-sdk'
import { versionDir } from './paths'
import { isHostCompatible } from './host-compatibility'

// Read the manifest.json persisted into a version folder at install time.
// Returns null if absent/unreadable (e.g. a renderer-only or legacy install).
export function readInstalledManifestUnchecked(id: string, version: string): PluginManifest | null {
  try {
    return JSON.parse(
      readFileSync(join(versionDir(id, version), 'manifest.json'), 'utf8')
    ) as PluginManifest
  } catch {
    return null
  }
}

// Ordinary consumers see only manifests this packaged host may run. Activation
// paths use the unchecked reader so they can return a precise incompatibility
// error before changing current.txt.
export function readInstalledManifest(id: string, version: string): PluginManifest | null {
  const manifest = readInstalledManifestUnchecked(id, version)
  return manifest && isHostCompatible(manifest) ? manifest : null
}
