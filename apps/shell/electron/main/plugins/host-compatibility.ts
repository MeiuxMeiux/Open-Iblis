// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import type { PluginManifest } from '@iblis/plugin-sdk'
import { compareSemver } from './semver'

export interface HostCompatibility {
  version: string
  enforce: boolean
}

// Packaged builds carry the release version stamped by shell-build.yml.
// Unpackaged development builds retain package.json's 0.0.0 placeholder and
// deliberately bypass the gate so `just dev` can exercise the current catalog.
function currentHostCompatibility(): HostCompatibility {
  return { version: app.getVersion(), enforce: app.isPackaged }
}

export function assertHostCompatible(
  manifest: PluginManifest,
  host: HostCompatibility = currentHostCompatibility()
): void {
  if (!host.enforce || compareSemver(host.version, manifest.hostMinVersion) >= 0) return
  throw new Error(
    `${manifest.name} ${manifest.version} requires Iblis ${manifest.hostMinVersion} or newer; ` +
      `this host is ${host.version}`
  )
}

export function isHostCompatible(
  manifest: PluginManifest,
  host: HostCompatibility = currentHostCompatibility()
): boolean {
  try {
    assertHostCompatible(manifest, host)
    return true
  } catch {
    return false
  }
}
