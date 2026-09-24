// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow, ipcMain } from 'electron'
import { err, ok, type IpcResult, type StorageLocation } from '../../shared/contract'
import { chooseStorageLocation, storageLocation } from './storage'
import { guard, guardAsync } from './ipc-guard'

export function registerStorageIpc(hasPendingPluginInstall: () => boolean): void {
  ipcMain.handle('storage:location', (): IpcResult<StorageLocation> => guard(storageLocation))
  ipcMain.handle('storage:choose-location', (event) =>
    guardAsync(() => chooseStorageLocation(BrowserWindow.fromWebContents(event.sender)))
  )
  ipcMain.handle('storage:restart-to-apply', (): IpcResult<null> => {
    if (hasPendingPluginInstall()) {
      return err('Wait for queued plugin downloads to finish or cancel them before restarting.')
    }
    app.relaunch()
    app.exit(0)
    return ok(null)
  })
}
