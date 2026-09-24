// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, ipcMain } from 'electron'
import {
  ok,
  err,
  type AppInfo,
  type DiagLevel,
  type InstalledSkin,
  type IpcResult,
  type UpdateStatus,
  type WindowState
} from '../../shared/contract'
import { getLevel, setLevel, send as sendDiag } from './diag'
import { log } from './logger'
import { checkForUpdatesNow, currentUpdateStatus, quitAndInstall } from './updater'
import { loadCatalog } from './catalog/client'
import { readInstalledSkins } from './plugins/installed-skins'
import { engineProvider } from './engine'
import { guard, guardAsync, winFrom } from './ipc-guard'
import { hasPendingPluginInstall, registerPluginIpc } from './ipc-plugins'
import { registerQueueIpc } from './ipc-queue'
import { registerLibraryIpc } from './ipc-library'
import { registerStorageIpc } from './ipc-storage'
import { registerTrainingIpc } from './ipc-training'
import { registerLicensingIpc } from './ipc-licensing'
import { registerCloudProviderIpc } from './ipc-cloud-providers'
import { registerProcessorIpc } from './ipc-processors'
import { registerEngineOpsIpc } from './ipc-engine-ops'
import { registerFeedbackIpc } from './ipc-feedback'
import { errorMessage } from './error-message'
import { isOfficialBuild } from './official-endpoints'

function appInfo(): AppInfo {
  // Typed as always-present, but a plain Node host (tests) lacks electron/chrome.
  const versions: Partial<NodeJS.ProcessVersions> = process.versions
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: versions.electron ?? 'unknown',
    chrome: versions.chrome ?? 'unknown',
    node: versions.node ?? 'unknown',
    platform: process.platform,
    officialBuild: isOfficialBuild()
  }
}

function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', (e): IpcResult<null> => {
    winFrom(e)?.minimize()
    return ok(null)
  })

  ipcMain.handle('window:toggleMaximize', (e): IpcResult<WindowState> => {
    const win = winFrom(e)
    if (!win) return ok({ maximized: false })
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return ok({ maximized: win.isMaximized() })
  })

  ipcMain.handle('window:isMaximized', (e): IpcResult<WindowState> => {
    return ok({ maximized: winFrom(e)?.isMaximized() ?? false })
  })

  ipcMain.handle('window:close', (e): IpcResult<null> => {
    winFrom(e)?.close()
    return ok(null)
  })
}

// Registered once at startup. Every handler returns the result envelope.
export function registerIpc(): void {
  ipcMain.handle('app:getInfo', (): IpcResult<AppInfo> => ok(appInfo()))
  registerStorageIpc(hasPendingPluginInstall)

  registerWindowIpc()

  ipcMain.handle('update:get-status', (): IpcResult<UpdateStatus | null> =>
    ok(currentUpdateStatus())
  )
  ipcMain.handle('update:check-now', async (): Promise<IpcResult<null>> =>
    guardAsync(async () => {
      await checkForUpdatesNow()
      return null
    })
  )
  ipcMain.handle('update:install', (): IpcResult<null> => {
    quitAndInstall()
    return ok(null)
  })

  ipcMain.handle('catalog:list', () => loadCatalog())
  registerPluginIpc()

  ipcMain.handle('skins:list', (): IpcResult<InstalledSkin[]> => guard(readInstalledSkins))

  ipcMain.handle('engine:info', () => guardAsync(() => engineProvider().engineInfo()))
  ipcMain.handle('engine:list', () => guard(() => engineProvider().listEngineSummaries()))
  ipcMain.handle('engine:select', (_e, pluginId: string) =>
    guard(() => {
      if (typeof pluginId !== 'string' || pluginId.length === 0 || pluginId.length > 128) {
        throw new Error('engine id is invalid')
      }
      const provider = engineProvider()
      provider.selectEngine(pluginId)
      return provider.listEngineSummaries()
    })
  )
  registerQueueIpc()
  registerLibraryIpc()

  ipcMain.handle('diag:getLevel', () => guard(getLevel))
  ipcMain.handle('diag:setLevel', (_e, level: DiagLevel): IpcResult<null> => {
    setLevel(level)
    return ok(null)
  })
  ipcMain.handle('diag:send', async (_e, note?: string) => {
    try {
      return ok(await sendDiag(note))
    } catch (e) {
      return err(errorMessage(e))
    }
  })

  registerTrainingIpc()
  registerLicensingIpc()
  registerCloudProviderIpc()
  registerProcessorIpc()
  registerEngineOpsIpc()
  registerFeedbackIpc()

  log('info', 'ipc handlers registered')
}
