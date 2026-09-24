// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../../shared/contract'
import { log } from './logger'
import { ignoreFailure } from './ignore-failure'
import { updateFeedUrl } from './official-endpoints'

type Notify = (status: UpdateStatus) => void
type UpdaterEvent =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error'

export interface UpdaterClient {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: UpdaterEvent, listener: (...args: never[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

export interface UpdateController {
  checkNow(): Promise<void>
  checkIfDue(): void
  getStatus(): UpdateStatus | null
}

// A running shell re-checks the update feed at most this often (foreground
// only). Six hours keeps recurring GCS GETs of latest.yml negligible without
// hurting delivery: the launch check is immediate, focus-return re-checks on
// the same bound, and Settings -> Check now is always available.
export const FOREGROUND_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// Keep updater state in main rather than relying on a renderer listener being
// mounted before the launch check emits. This also keeps all update traffic on
// Electron main; the renderer can only ask main to start a normal signed check.
export function createUpdateController(
  updater: UpdaterClient,
  notify: Notify,
  now: () => number = Date.now
): UpdateController {
  let status: UpdateStatus | null = null
  let lastCheckAt = Number.NEGATIVE_INFINITY

  const publish = (next: UpdateStatus): void => {
    status = next
    notify(next)
  }

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true

  updater.on('checking-for-update', () => publish({ state: 'checking' }))
  updater.on('update-available', (info: { version: string }) => {
    log('info', 'update available', { version: info.version })
    publish({ state: 'available', version: info.version })
  })
  updater.on('update-not-available', () => publish({ state: 'current' }))
  updater.on('download-progress', (progress: { percent: number }) => {
    publish({ state: 'downloading', percent: Math.round(progress.percent) })
  })
  updater.on('update-downloaded', (info: { version: string }) => {
    log('info', 'update downloaded', { version: info.version })
    publish({ state: 'ready', version: info.version })
  })
  updater.on('error', (error: unknown) => {
    const message = String(error)
    log('error', 'update error', { error: message })
    publish({ state: 'error', error: message })
  })

  const checkNow = async (): Promise<void> => {
    lastCheckAt = now()
    await updater.checkForUpdates()
  }

  return {
    checkNow,
    checkIfDue: (): void => {
      if (now() - lastCheckAt < FOREGROUND_CHECK_INTERVAL_MS) return
      void checkNow().catch(ignoreFailure)
    },
    getStatus: (): UpdateStatus | null => status
  }
}

let controller: UpdateController | null = null
let foreground = true
let foregroundTimer: ReturnType<typeof setInterval> | undefined

// Wires electron-updater against the generic GCS feed configured in
// electron-builder.yml. Disabled in dev (no app-update.yml when unpackaged)
// and in source builds: electron-builder writes the official feed into every
// package, so without this check a self-built app would update itself onto
// an official installer. official-endpoints.ts decides which build this is.
export function autoUpdateEnabled(packaged: boolean, feed: string): boolean {
  return packaged && feed !== ''
}

export function initAutoUpdate(notify: Notify): void {
  if (!app.isPackaged) {
    log('info', 'auto-update disabled (not packaged)')
    return
  }
  if (!autoUpdateEnabled(app.isPackaged, updateFeedUrl())) {
    log('info', 'auto-update disabled (source build has no update feed)')
    return
  }

  controller = createUpdateController(autoUpdater, notify)
  foreground = true
  app.on('browser-window-focus', () => {
    foreground = true
    controller?.checkIfDue()
  })
  app.on('browser-window-blur', () => {
    foreground = false
  })

  // The launch check is immediate. Afterwards, a running shell checks at most
  // once per FOREGROUND_CHECK_INTERVAL_MS and only while it is in the
  // foreground. A focus return uses the same bound, so background time cannot
  // create a burst of requests.
  void controller.checkNow().catch(ignoreFailure)
  foregroundTimer ??= setInterval(() => {
    if (foreground) controller?.checkIfDue()
  }, FOREGROUND_CHECK_INTERVAL_MS)
}

export function checkForUpdatesNow(): Promise<void> {
  if (!controller) {
    return Promise.reject(
      new Error(
        updateFeedUrl() === ''
          ? 'This source build does not update itself. Rebuild from source to update.'
          : 'Updates are unavailable in this build'
      )
    )
  }
  return controller.checkNow()
}

export function currentUpdateStatus(): UpdateStatus | null {
  return controller?.getStatus() ?? null
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
