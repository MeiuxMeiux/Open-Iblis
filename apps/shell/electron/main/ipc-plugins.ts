// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Plugin install/rollback/removal (one FIFO install queue) and the adapter
// library, including the engine compatibility proof.

import { BrowserWindow, ipcMain } from 'electron'
import { err, ok, type InstalledPlugin, type IpcResult } from '../../shared/contract'
import type { AdapterImportDetails, ImportedAdapterFormat } from '../../shared/adapters'
import type { PluginInstallQueueSnapshot } from '../../shared/plugin-install-queue'
import { listInstalled } from './plugins/registry'
import { installFromCatalog, rollbackPlugin, removePlugin } from './plugins/lifecycle'
import { PluginInstallQueue } from './plugins/install-queue'
import { healthAll } from './sidecar/supervisor'
import {
  importAdapterFromDialog,
  installAdapterOffer,
  listAdapters,
  removeAdapter,
  revealAdapter
} from './adapters'
import { adapterOffers } from './adapters/offers'
import {
  revealAdapterCompatibilityProof,
  runAdapterCompatibilityProof
} from './adapters/compatibility-proof'
import { errorMessage } from './error-message'
import { guard, guardAsync, winFrom } from './ipc-guard'

const pluginInstallQueue = new PluginInstallQueue<IpcResult<InstalledPlugin>>()

function broadcastPluginInstallQueue(snapshot: PluginInstallQueueSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('plugins:install-queue', snapshot)
  }
}

export function hasPendingPluginInstall(): boolean {
  return pluginInstallQueue.entries().length > 0
}

export function registerPluginIpc(): void {
  pluginInstallQueue.subscribe(broadcastPluginInstallQueue)
  registerAdapterIpc()
  ipcMain.handle('plugins:list', (): IpcResult<InstalledPlugin[]> => guard(listInstalled))
  ipcMain.handle('plugins:install-queue', (): IpcResult<PluginInstallQueueSnapshot> =>
    ok(pluginInstallQueue.snapshot())
  )
  ipcMain.handle('plugins:install', async (e, id: string, version: string) => {
    const win = winFrom(e)
    try {
      return await pluginInstallQueue.enqueue(
        id,
        version,
        (signal) =>
          installFromCatalog(id, version, {
            signal,
            // Stream only from the active FIFO job to the window that asked.
            onProgress: (p) => {
              if (win && !win.isDestroyed()) win.webContents.send('plugins:install-progress', p)
            }
          }),
        () => err('install cancelled'),
        (error) => err(`install failed: ${errorMessage(error)}`),
        (result) => {
          if (result.ok) return { outcome: 'completed' }
          if (result.error === 'install cancelled') return { outcome: 'cancelled' }
          return { outcome: 'failed', message: result.error }
        }
      )
    } catch (error) {
      return err(errorMessage(error))
    }
  })
  ipcMain.handle('plugins:cancel-install', (_e, id: string): IpcResult<null> => {
    pluginInstallQueue.cancel(id)
    return ok(null)
  })
  ipcMain.handle('plugins:rollback', (_e, id: string) => rollbackPlugin(id))
  ipcMain.handle('plugins:remove', (_e, id: string) => removePlugin(id))
  ipcMain.handle('plugins:health', () => guard(healthAll))
}

function registerAdapterIpc(): void {
  ipcMain.handle('adapters:list', () => guardAsync(listAdapters))
  ipcMain.handle('adapters:offers', () => guard(adapterOffers))
  ipcMain.handle(
    'adapters:import-from-dialog',
    (e, format: ImportedAdapterFormat, details: AdapterImportDetails, acknowledged: boolean) =>
      guardAsync(() => importAdapterFromDialog(winFrom(e), format, details, acknowledged))
  )
  ipcMain.handle('adapters:remove', (_e, id: string) =>
    guardAsync(async () => {
      await removeAdapter(id)
      return null
    })
  )
  ipcMain.handle('adapters:reveal', (_e, id: string) =>
    guardAsync(async () => {
      await revealAdapter(id)
      return null
    })
  )
  ipcMain.handle('adapters:install-offer', (e, id: string, acknowledged: boolean) =>
    guardAsync(() =>
      installAdapterOffer(id, acknowledged, (progress) => {
        const win = winFrom(e)
        if (win && !win.isDestroyed()) win.webContents.send('adapters:install-progress', progress)
      })
    )
  )
  ipcMain.handle('adapters:run-compatibility-proof', (e, id: string) =>
    guardAsync(() =>
      runAdapterCompatibilityProof(winFrom(e), id, (status) => {
        const win = winFrom(e)
        if (win && !win.isDestroyed()) {
          win.webContents.send('adapters:compatibility-proof-progress', status)
        }
      })
    )
  )
  ipcMain.handle('adapters:reveal-compatibility-proof', (_e, proofId: string) =>
    guardAsync(async () => {
      await revealAdapterCompatibilityProof(proofId)
      return null
    })
  )
}
