// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'node:path'
import { externalUrlAllowed, rendererDevUrl, sameDocument } from './navigation-policy'

const PRELOAD = join(__dirname, '../preload/index.js')

export function createMainWindow(): BrowserWindow {
  const isWin = process.platform === 'win32'

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    title: 'Iblis — Soulless Music',
    backgroundColor: isWin ? '#00000000' : '#0c0b10',
    // Windows 11 Mica backdrop. No-op on other platforms.
    ...(isWin ? { backgroundMaterial: 'mica' as const } : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // External links open in the OS browser (https only); the renderer never
  // navigates. See navigation-policy.ts.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (externalUrlAllowed(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const stayPut = (event: Electron.Event, url: string): void => {
    if (!sameDocument(url, win.webContents.getURL())) event.preventDefault()
  }
  win.webContents.on('will-navigate', stayPut)
  win.webContents.on('will-redirect', stayPut)

  const notify = (): void => win.webContents.send('window:maximize-change', win.isMaximized())
  win.on('maximize', notify)
  win.on('unmaximize', notify)

  return win
}

// Session-wide lockdown, once at app ready: no web permission (camera,
// microphone, geolocation, notifications, ...) is ever granted to web
// content (the shell needs none), and no <webview> can attach.
export function hardenSessions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

export function loadRenderer(win: BrowserWindow): void {
  const devUrl = rendererDevUrl(process.env, app.isPackaged)
  if (devUrl !== null) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}
