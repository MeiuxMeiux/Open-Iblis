// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow } from 'electron'
import { createMainWindow, hardenSessions, loadRenderer } from './window'
import { registerIpc } from './ipc'
import { initAutoUpdate } from './updater'
import { startInstalledSidecars } from './plugins/lifecycle'
import { stopAll } from './sidecar/supervisor'
import { initDiagnostics } from './diag'
import { getProcessorInput, registerTrackProtocol } from './library'
import { log } from './logger'
import { shutdownTrackAnalysis } from './library/analysis'
import {
  initializeGenerationQueue,
  markGenerationRuntimeReady,
  shutdownGenerationQueue
} from './generation-queue'
import { initializeResourceState } from './resource-state'
import { initializeTraining } from './training'
import { initializeProcessors } from './processors'
import { processorsMayRun } from './processor-gate'
import { initializeCloudProviderHost } from './cloud-providers'
import { prepareStorage } from './storage'
import { registerMediaSchemes } from './media/schemes'
import { registerActionsProbeProtocol } from './engine/actions-probe-media'
import { ignoreFailure } from './ignore-failure'

// A requested data-root migration runs before any store or sidecar reads its
// path. The small Electron profile stays put, so this is safe before ready.
prepareStorage()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  const openWindow = (): void => {
    mainWindow = createMainWindow()
    loadRenderer(mainWindow)
  }

  registerMediaSchemes() // must precede app ready
  registerIpc()

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app
    .whenReady()
    .then(() => {
      hardenSessions()
      registerTrackProtocol()
      registerActionsProbeProtocol()
      openWindow()
      initAutoUpdate((status) => mainWindow?.webContents.send('update:status', status))
      initDiagnostics()
      initializeCloudProviderHost()
      void startInstalledSidecars()
        .catch((error: unknown) => {
          log('error', 'installed sidecar startup failed', { error: String(error) })
        })
        .finally(() => {
          markGenerationRuntimeReady()
          void initializeGenerationQueue()
            .then(() => initializeResourceState())
            .then(() => initializeTraining())
            // Processor analysis is elective background work. Its store or
            // recovery must never make the shell, queue, or Training unusable.
            .then(() =>
              initializeProcessors({ input: getProcessorInput, mayRun: processorsMayRun }).catch(
                (error: unknown) => {
                  log('error', 'processor host initialization failed', { error: String(error) })
                }
              )
            )
            .catch((error: unknown) => {
              log('error', 'core startup initialization failed', { error: String(error) })
            })
        })
      log('info', 'shell started', { version: app.getVersion(), platform: process.platform })
    })
    .catch((e: unknown) => {
      log('error', 'boot failed', { error: String(e) })
      app.quit()
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Never leave orphaned sidecars behind when the app exits.
  app.on('will-quit', (e) => {
    e.preventDefault()
    void shutdownGenerationQueue()
      .catch(ignoreFailure)
      .then(() => Promise.allSettled([stopAll(), shutdownTrackAnalysis()]))
      .finally(() => app.exit(0))
  })
}
