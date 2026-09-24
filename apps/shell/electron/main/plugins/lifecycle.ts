// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { ok, err, type IpcResult, type InstalledPlugin } from '../../../shared/contract'
import { loadCatalog } from '../catalog/client'
import { install, rollback, remove, status, listInstalled } from './registry'
import { readInstalledManifest, readInstalledManifestUnchecked } from './installed-manifest'
import type { InstallOptions } from './install'
import * as supervisor from '../sidecar/supervisor'
import { acquireEngineMutation } from '../generation-queue'
import { acquireProcessorMutation } from '../processors'
import type { PluginManifest } from '@iblis/plugin-sdk'
import { assertHostCompatible } from './host-compatibility'
import { engineLaunchManifest } from './launch-manifest'
import { log } from '../logger'
import { ignoreFailure } from '../ignore-failure'
import { errorMessage } from '../error-message'

export { engineLaunchManifest } from './launch-manifest'

// Ties the on-disk registry to the sidecar supervisor so the four UI verbs are
// complete: install also launches, rollback re-launches the prior version,
// remove also stops the process. The renderer only ever names an id+version;
// manifests come from the signature-verified catalog or the on-disk copy.

export async function installFromCatalog(
  id: string,
  version: string,
  opts?: InstallOptions
): Promise<IpcResult<InstalledPlugin>> {
  const cat = await loadCatalog()
  if (!cat.ok) return cat

  const entry = cat.data.plugins.find((p) => p.manifest.id === id && p.manifest.version === version)
  if (!entry) return err(`plugin ${id}@${version} is not in the signed catalog`)
  let release: (() => Promise<void>) | undefined
  try {
    if (entry.manifest.kind === 'engine') release = await acquireEngineMutation()
    if (entry.manifest.kind === 'processor')
      release = await acquireProcessorMutation(entry.manifest.id)
    const result = await install(entry.manifest, opts)
    // On-demand sidecars (contract-v2 engines) are not started by an install;
    // a live older version is still hot-swapped so it cannot keep serving.
    if (
      entry.manifest.executable &&
      (!onDemandOnly(entry.manifest) || isRunning(entry.manifest.id))
    )
      await supervisor.hotSwap(await engineLaunchManifest(entry.manifest))
    return ok(result)
  } catch (e) {
    // A user cancel is a clean outcome, not a failure — install() already wiped
    // the partial staging folder, so the plugin is simply not installed.
    if (opts?.signal?.aborted) return err('install cancelled')
    return err(`install failed: ${errorMessage(e)}`)
  } finally {
    await release?.().catch(ignoreFailure)
  }
}

export async function rollbackPlugin(id: string): Promise<IpcResult<InstalledPlugin>> {
  let release: (() => Promise<void>) | undefined
  try {
    if (isEngine(id)) release = await acquireEngineMutation()
    if (isProcessor(id)) release = await acquireProcessorMutation(id)
    const result = rollback(id) // flips the pointer to the previous version
    await relaunchActive(id)
    return ok(result)
  } catch (e) {
    return err(`rollback failed: ${errorMessage(e)}`)
  } finally {
    await release?.().catch(ignoreFailure)
  }
}

export async function removePlugin(id: string): Promise<IpcResult<null>> {
  let release: (() => Promise<void>) | undefined
  try {
    if (isEngine(id)) release = await acquireEngineMutation()
    if (isProcessor(id)) release = await acquireProcessorMutation(id)
    await supervisor.stop(id)
    remove(id)
    return ok(null)
  } catch (e) {
    return err(`remove failed: ${errorMessage(e)}`)
  } finally {
    await release?.().catch(ignoreFailure)
  }
}

function isEngine(id: string): boolean {
  const active = status(id).activeVersion
  return active ? readInstalledManifest(id, active)?.kind === 'engine' : false
}

// Contract-v2 engines are heavyweight, on-demand sidecars: the v2 driver
// starts them for a take and unloads them after their idle window. Boot,
// install, and rollback never start one that is not already running.
function onDemandOnly(manifest: PluginManifest | null): boolean {
  return manifest?.engine?.protocolVersion === 2
}

function isRunning(id: string): boolean {
  return supervisor.healthAll()[id]?.running ?? false
}

function isProcessor(id: string): boolean {
  const active = status(id).activeVersion
  return active ? readInstalledManifest(id, active)?.kind === 'processor' : false
}

// Bring the supervisor in line with whatever version is now active on disk.
async function relaunchActive(id: string): Promise<void> {
  const active = status(id).activeVersion
  if (!active) return supervisor.stop(id)
  const manifest = readInstalledManifest(id, active)
  if (manifest?.executable && onDemandOnly(manifest) && !isRunning(id)) return
  if (manifest?.executable) await supervisor.hotSwap(await engineLaunchManifest(manifest))
  else await supervisor.stop(id)
}

// On boot, start a sidecar for every installed plugin whose active version has
// an executable. Renderer-only plugins are skipped.
export async function startInstalledSidecars(): Promise<void> {
  for (const plugin of listInstalled()) {
    if (!plugin.activeVersion) continue
    const manifest = readInstalledManifestUnchecked(plugin.id, plugin.activeVersion)
    if (manifest) {
      try {
        assertHostCompatible(manifest)
      } catch (error) {
        log('warn', 'plugin skipped at boot because host is too old', {
          id: plugin.id,
          version: plugin.activeVersion,
          error: errorMessage(error)
        })
        continue
      }
    }
    // Training packs are heavyweight, on-demand sidecars: the Training
    // pipeline spawns them for a run and stops them after. Never at boot.
    // Contract-v2 engines are equally on-demand: the v2 driver starts the
    // selected one when a take needs it, so boot must not start every engine.
    if (manifest?.kind === 'training' || onDemandOnly(manifest)) continue
    if (manifest?.executable) await supervisor.start(await engineLaunchManifest(manifest))
  }
}

// Hot-swap every running engine sidecar with its current version so a spawn-time
// change (e.g. the performance profile's OMP_NUM_THREADS) takes effect without a
// full app restart. hotSwap brings the new process up healthy before retiring
// the old, so generations stay available across the swap.
export async function restartActiveSidecars(): Promise<void> {
  const release = await acquireEngineMutation()
  try {
    for (const plugin of listInstalled()) {
      if (!plugin.activeVersion) continue
      const manifest = readInstalledManifest(plugin.id, plugin.activeVersion)
      if (manifest?.kind === 'training') continue // on-demand only, never restarted here
      if (onDemandOnly(manifest) && !isRunning(plugin.id)) continue
      if (manifest?.executable) await supervisor.hotSwap(await engineLaunchManifest(manifest))
    }
  } finally {
    await release().catch(ignoreFailure)
  }
}
