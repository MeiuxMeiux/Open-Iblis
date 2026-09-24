// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Electron wiring for the resource coordinator: binds the pure module to the
// real queue lease, the engine sidecar, and the renderer broadcast channel.

import { BrowserWindow } from 'electron'
import type { PluginManifest } from '@iblis/plugin-sdk'
import type { ResourceState } from '../../../shared/training'
import { acquireEmptyQueueEngineMutation, subscribeQueueSnapshots } from '../generation-queue'
import { readInstalledManifest } from '../plugins/installed-manifest'
import { listInstalled } from '../plugins/registry'
import { healthAll, start, stop } from '../sidecar/supervisor'
import { log } from '../logger'
import { createResourceCoordinator, type ResourceCoordinator } from './coordinator'

function activeEngineManifest(): PluginManifest | null {
  for (const plugin of listInstalled()) {
    if (!plugin.activeVersion) continue
    const manifest = readInstalledManifest(plugin.id, plugin.activeVersion)
    if (manifest?.kind === 'engine') return manifest
  }
  return null
}

let singleton: ResourceCoordinator | null = null

export function resourceCoordinator(): ResourceCoordinator {
  if (singleton) return singleton
  singleton = createResourceCoordinator({
    acquireExclusive: acquireEmptyQueueEngineMutation,
    async stopEngine() {
      const manifest = activeEngineManifest()
      if (!manifest) return false
      const running = healthAll()[manifest.id]?.running ?? false
      if (running) await stop(manifest.id)
      return running
    },
    async startEngine() {
      const manifest = activeEngineManifest()
      if (!manifest) return
      // Restore through the same launch path as boot so a training that just
      // produced a new style comes back with that style already loadable.
      const { engineLaunchManifest } = await import('../plugins/lifecycle')
      await start(await engineLaunchManifest(manifest))
    }
  })
  singleton.subscribe((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('resource:state', state)
    }
  })
  return singleton
}

// Called once at startup so 'generating' mirrors the queue's snapshot stream.
export async function initializeResourceState(): Promise<void> {
  const coordinator = resourceCoordinator()
  try {
    await subscribeQueueSnapshots((snapshot) => {
      coordinator.noteGenerating(Boolean(snapshot.activeId))
    })
  } catch (error) {
    log('error', 'resource-state queue subscription failed', { error: String(error) })
  }
}

export function resourceState(): ResourceState {
  return resourceCoordinator().snapshot()
}
