// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import {
  matchesPlatform,
  platformSupportError,
  type HostPlatform,
  type PluginManifest
} from '@iblis/plugin-sdk'
import { compareSemver } from './semver'

export interface HostCompatibility {
  version: string
  enforce: boolean
  platform?: HostPlatform
}

// The OS/CPU pair plugin platform targets are matched against (SDK
// platform.ts). process.arch is the build's arch: the x64 build under Rosetta
// reports x64 and therefore gets x64 assets, which is what it can run.
export function hostPlatform(): HostPlatform {
  return { os: process.platform, arch: process.arch }
}

// True when this host is one of `targets` (SDK target syntax).
export function hostMatches(targets: readonly string[]): boolean {
  return matchesPlatform(targets, hostPlatform())
}

// Packaged builds carry the release version stamped by shell-build.yml.
// Unpackaged development builds retain package.json's 0.0.0 placeholder and
// deliberately bypass the gate so `just dev` can exercise the current catalog.
// The platform check rides the same switch: a dev build may install a pack
// for another OS (its tests do, on Linux), a packaged build never does.
function currentHostCompatibility(): HostCompatibility {
  return { version: app.getVersion(), enforce: app.isPackaged, platform: hostPlatform() }
}

export function assertHostCompatible(
  manifest: PluginManifest,
  host: HostCompatibility = currentHostCompatibility()
): void {
  if (!host.enforce) return
  const platformError = platformSupportError(manifest, host.platform ?? hostPlatform())
  if (platformError !== null) throw new Error(platformError)
  if (compareSemver(host.version, manifest.hostMinVersion) >= 0) return
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
