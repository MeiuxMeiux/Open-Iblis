// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The IPC result envelope around a handler body: a throw (sync or async)
// becomes err(message), so no handler ever rejects across the bridge.

import { BrowserWindow } from 'electron'
import { err, ok, type IpcResult } from '../../shared/contract'
import { errorMessage } from './error-message'

export function guard<T>(fn: () => T): IpcResult<T> {
  try {
    return ok(fn())
  } catch (e) {
    return err(errorMessage(e))
  }
}

export async function guardAsync<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return ok(await fn())
  } catch (e) {
    return err(errorMessage(e))
  }
}

export function winFrom(e: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}
