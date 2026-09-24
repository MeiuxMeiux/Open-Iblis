// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Licensing IPC handlers, split from ipc.ts like ipc-training.ts.
// Registered by registerIpc(). See docs/admin/03-shell-integration.md.

import { ipcMain } from 'electron'
import { err, ok, type IpcResult } from '../../shared/contract'
import type { LicensingState } from '../../shared/licensing'
import { initLicensing, licensingService } from './licensing'
import { errorMessage } from './error-message'

async function guardState(fn: () => Promise<LicensingState>): Promise<IpcResult<LicensingState>> {
  try {
    return ok(await fn())
  } catch (e) {
    return err(errorMessage(e))
  }
}

// Renderer arguments are untrusted even when the preload types them. Coerce
// exactly like String(), with null/undefined mapping to ''.
function stringArg(value: unknown): string {
  const present: unknown = value ?? ''
  return String(present)
}

export function registerLicensingIpc(): void {
  initLicensing()
  ipcMain.handle('licensing:state', (): IpcResult<LicensingState> => {
    try {
      return ok(licensingService().state())
    } catch (e) {
      return err(errorMessage(e))
    }
  })
  ipcMain.handle('licensing:activate', (_e, key: unknown) =>
    guardState(() => licensingService().activateKey(stringArg(key)))
  )
  ipcMain.handle('licensing:deactivate', () => guardState(() => licensingService().removeKey()))
  ipcMain.handle('licensing:refresh', () => guardState(() => licensingService().refresh()))
}
