// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import type { ExecutableSpec, PluginAsset, PluginManifest } from './manifest.js'

// Platform targeting for plugin manifests (docs/feature/platforms.md).
//
// A target is an OS ("darwin") or an OS plus a CPU ("darwin-arm64"), named as
// Node reports them (process.platform, process.arch). Three manifest fields
// use targets, all optional and all meaning "every platform" when absent:
//
//   manifest.platforms            where the plugin runs at all
//   asset.platforms               which hosts download this asset
//   executable.platforms[]        per-host overrides of bin/args
//
// Old hosts ignore these fields. A manifest that uses them must therefore
// require a host that understands them (PLATFORM_FIELDS_MIN_HOST); the catalog
// build enforces that, so an old Windows shell never downloads Mac bytes.

export const PLATFORM_OSES = ['win32', 'darwin', 'linux'] as const
export const PLATFORM_ARCHES = ['x64', 'arm64'] as const

export type PlatformOs = (typeof PLATFORM_OSES)[number]
export type PlatformArch = (typeof PLATFORM_ARCHES)[number]
export type PlatformTarget = PlatformOs | `${PlatformOs}-${PlatformArch}`

// The first shell release that reads the platform fields. Bump together with
// the release that ships this file.
export const PLATFORM_FIELDS_MIN_HOST = '0.2.0-alpha.61'

export interface HostPlatform {
  os: string
  arch: string
}

// Per-host replacement of the executable's bin and/or args. The first entry
// whose targets match the host wins; fields it leaves out keep the base value.
export interface ExecutableOverride {
  platforms: PlatformTarget[]
  bin?: string
  args?: string[]
}

export function isPlatformTarget(v: unknown): v is PlatformTarget {
  if (typeof v !== 'string') return false
  const [os, arch, extra] = v.split('-')
  if (extra !== undefined || !(PLATFORM_OSES as readonly string[]).includes(os ?? '')) return false
  return arch === undefined || (PLATFORM_ARCHES as readonly string[]).includes(arch)
}

export function platformKey(host: HostPlatform): string {
  return `${host.os}-${host.arch}`
}

// Absent or empty target list = every platform.
export function matchesPlatform(
  targets: readonly string[] | undefined,
  host: HostPlatform
): boolean {
  if (!targets || targets.length === 0) return true
  const key = platformKey(host)
  return targets.some((t) => t === host.os || t === key)
}

const NODE_SCRIPT = /\.(?:c|m)?js$/i

// Every native pack published before the platform fields existed is a
// Windows x64 build (ace-server.exe, iblis-stems.exe, the training runtime).
// A manifest that says nothing about platforms but launches a native binary is
// therefore Windows-only; Node-script sidecars and sidecar-less plugins (skins,
// cloud providers, renderer packs) run anywhere.
export const LEGACY_NATIVE_PLATFORMS: readonly PlatformTarget[] = ['win32-x64']

export function effectivePlatforms(manifest: PluginManifest): readonly string[] | undefined {
  if (manifest.platforms && manifest.platforms.length > 0) return manifest.platforms
  const exec = manifest.executable
  if (!exec) return undefined
  const bins = [exec.bin, ...(exec.platforms ?? []).flatMap((o) => (o.bin ? [o.bin] : []))]
  if (bins.every((bin) => NODE_SCRIPT.test(bin))) return undefined
  // An executable that declares per-platform overrides already speaks the new
  // contract; only a bare native bin is presumed to be a legacy Windows pack.
  return exec.platforms && exec.platforms.length > 0 ? undefined : LEGACY_NATIVE_PLATFORMS
}

const OS_NAMES: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
export function describePlatform(target: string): string {
  const [os = '', arch] = target.split('-')
  const osName = OS_NAMES[os] ?? os
  if (arch === undefined) return osName
  if (os === 'darwin') return `${osName} (${arch === 'arm64' ? 'Apple Silicon' : 'Intel'})`
  return `${osName} ${arch}`
}

// null when the plugin runs on this host; otherwise one sentence for the UI.
export function platformSupportError(manifest: PluginManifest, host: HostPlatform): string | null {
  const targets = effectivePlatforms(manifest)
  if (matchesPlatform(targets, host)) return null
  const where = (targets ?? []).map(describePlatform).join(', ')
  return `${manifest.name} ${manifest.version} is available for ${where} only; this computer is ${describePlatform(platformKey(host))}.`
}

export function assetsForPlatform(manifest: PluginManifest, host: HostPlatform): PluginAsset[] {
  return manifest.assets.filter((asset) => matchesPlatform(asset.platforms, host))
}

// The executable this host runs: the first matching override applied over the
// base spec, with the override list itself dropped.
export function executableForPlatform(
  exec: ExecutableSpec,
  host: HostPlatform
): Omit<ExecutableSpec, 'platforms'> {
  const { platforms, ...base } = exec
  const override = platforms?.find((o) => matchesPlatform(o.platforms, host))
  if (!override) return base
  return {
    ...base,
    ...(override.bin !== undefined ? { bin: override.bin } : {}),
    ...(override.args !== undefined ? { args: override.args } : {})
  }
}

export function usesPlatformFields(manifest: PluginManifest): boolean {
  return (
    manifest.platforms !== undefined ||
    manifest.assets.some((a) => a.platforms !== undefined) ||
    manifest.executable?.platforms !== undefined
  )
}

// Every OS/CPU pair, for checks that must hold on each host.
export const ALL_HOSTS: readonly HostPlatform[] = PLATFORM_OSES.flatMap((os) =>
  PLATFORM_ARCHES.map((arch) => ({ os, arch }))
)

// On every host the manifest supports, the bin it would launch must be one of
// the assets that host downloads (or a Node script, which may also be an
// asset). Catches "ace-server for Mac declared, but only for Windows".
export function platformConsistencyErrors(manifest: PluginManifest, path = 'manifest'): string[] {
  const exec = manifest.executable
  if (!exec || !usesPlatformFields(manifest)) return []
  const errors: string[] = []
  for (const host of ALL_HOSTS) {
    if (!matchesPlatform(effectivePlatforms(manifest), host)) continue
    const { bin } = executableForPlatform(exec, host)
    const paths = new Set(assetsForPlatform(manifest, host).map((a) => a.path))
    if (!paths.has(bin)) {
      errors.push(
        `${path}.executable: on ${platformKey(host)} the bin "${bin}" is not an asset that host downloads`
      )
    }
  }
  return errors
}
