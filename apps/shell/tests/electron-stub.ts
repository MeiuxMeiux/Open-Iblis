// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Minimal `electron` stand-in for unit tests. The real module loads a native
// binary that can't run headless, so vitest aliases `electron` to this (see
// vitest.config.mts). Only the surface our main-process modules touch is stubbed.
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const app = {
  getPath: (name: string): string => join(tmpdir(), 'iblis-test', name),
  getName: (): string => 'Iblis',
  getVersion: (): string => '0.0.0-test',
  isPackaged: false,
  whenReady: async (): Promise<void> => {},
  on: (): void => {},
  quit: (): void => {},
  requestSingleInstanceLock: (): boolean => true
}

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
export const ipcMain = {
  handle: (channel: string, listener: (...args: unknown[]) => unknown): void => {
    ipcHandlers.set(channel, listener)
  },
  handlers: ipcHandlers
}
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s),
  decryptString: (b: Buffer): string => b.toString()
}
export const shell = {
  openExternal: async (): Promise<void> => {},
  showItemInFolder: (): void => {}
}
export const dialog = {
  showMessageBox: async (): Promise<{ response: number }> => ({ response: 0 }),
  showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: true,
    filePaths: []
  })
}
export const contextBridge = { exposeInMainWorld: (): void => {} }
export const ipcRenderer = {
  invoke: async (): Promise<unknown> => undefined,
  on: (): void => {},
  removeListener: (): void => {}
}

// A class, like the real export, so `new` and `instanceof` keep working.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BrowserWindow {
  static fromWebContents(): null {
    return null
  }
  static getAllWindows(): BrowserWindow[] {
    return []
  }
}
