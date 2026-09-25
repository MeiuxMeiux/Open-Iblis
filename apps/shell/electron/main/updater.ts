// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { autoUpdater, type NsisUpdater } from 'electron-updater'
import type { UpdateStatus } from '../../shared/contract'
import { log } from './logger'
import { ignoreFailure } from './ignore-failure'
import { updateFeedUrl } from './official-endpoints'
import {
  fetchReleaseSignature,
  sha512Base64,
  verifyReleaseSignature,
  type ReleaseSignature,
  type SignatureLookup
} from './release-signature'

type Notify = (status: UpdateStatus) => void
type UpdaterEvent =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'error'

// What electron-updater tells us about the version latest.yml offers.
interface UpdateOffer {
  version: string
  files?: readonly { sha512?: string }[]
}

export type VerifyHook = (publisherNames: string[], path: string) => Promise<string | null>

export interface UpdaterClient {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  // electron-updater runs this on the downloaded installer when app-update.yml
  // carries a publisherName (electron-builder.yml sets one for that reason).
  verifyUpdateCodeSignature: VerifyHook
  on(event: UpdaterEvent, listener: (...args: never[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
}

export interface UpdateController {
  checkNow(): Promise<void>
  checkIfDue(): void
  getStatus(): UpdateStatus | null
}

// Release-signature lookups, injectable for tests.
export interface SignatureDeps {
  fetchSignature: (version: string) => Promise<SignatureLookup>
  hashFile: (path: string) => Promise<string>
  // The shipped release public key unless a test supplies its own.
  pubKeyPem?: string
}

const defaultSignatureDeps: SignatureDeps = {
  fetchSignature: (version) => fetchReleaseSignature(updateFeedUrl(), version),
  hashFile: sha512Base64
}

// A running shell re-checks the update feed at most this often (foreground
// only). Six hours keeps recurring GCS GETs of latest.yml negligible without
// hurting delivery: the launch check is immediate, focus-return re-checks on
// the same bound, and Settings -> Check now is always available.
export const FOREGROUND_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// Keep updater state in main rather than relying on a renderer listener being
// mounted before the launch check emits. This also keeps all update traffic on
// Electron main; the renderer can only ask main to start a normal signed check.
//
// Trust model (audit 2026-09-24, H-SUP1): latest.yml only tells us an update
// exists. Nothing downloads until the offline release key's signature for
// that exact version is fetched and checks out, and nothing installs until
// the downloaded bytes hash to the signed sha512. See release-signature.ts.
export function createUpdateController(
  updater: UpdaterClient,
  notify: Notify,
  now: () => number = Date.now,
  deps: SignatureDeps = defaultSignatureDeps
): UpdateController {
  let status: UpdateStatus | null = null
  let lastCheckAt = Number.NEGATIVE_INFINITY
  // The signature that approved the download in flight, and the version
  // whose downloaded bytes the hook has verified against it.
  let approved: ReleaseSignature | null = null
  let verified: string | null = null

  const publish = (next: UpdateStatus): void => {
    status = next
    notify(next)
  }
  const refuse = (version: string, reason: string): void => {
    log('error', 'update refused', { version, reason })
    publish({ state: 'error', error: reason })
  }

  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.verifyUpdateCodeSignature = async (_publisherNames, path) => {
    if (approved === null) return 'no release signature was approved for this download'
    const reason = verifyReleaseSignature(
      approved,
      approved.version,
      await deps.hashFile(path),
      deps.pubKeyPem
    )
    if (reason === null) verified = approved.version
    return reason
  }

  const gate = async (offer: UpdateOffer): Promise<void> => {
    const lookup = await deps.fetchSignature(offer.version)
    if (lookup.kind === 'missing') {
      log('info', 'update awaiting release signature', { version: offer.version })
      publish({ state: 'pending', version: offer.version })
      return
    }
    if (lookup.kind === 'error') {
      refuse(offer.version, lookup.message)
      return
    }
    const feedSha512 = offer.files?.[0]?.sha512
    if (feedSha512 !== undefined && feedSha512 !== lookup.signature.sha512) {
      refuse(offer.version, 'update feed and release signature disagree')
      return
    }
    // Check the signature itself before spending the download; the hook
    // repeats this against the real bytes afterwards.
    const reason = verifyReleaseSignature(
      lookup.signature,
      offer.version,
      lookup.signature.sha512,
      deps.pubKeyPem
    )
    if (reason !== null) {
      refuse(offer.version, reason)
      return
    }
    approved = lookup.signature
    verified = null
    await updater.downloadUpdate()
  }

  updater.on('checking-for-update', () => publish({ state: 'checking' }))
  updater.on('update-available', (offer: UpdateOffer) => {
    log('info', 'update available', { version: offer.version })
    publish({ state: 'available', version: offer.version })
    gate(offer).catch((error: unknown) => refuse(offer.version, String(error)))
  })
  updater.on('update-not-available', () => publish({ state: 'current' }))
  updater.on('download-progress', (progress: { percent: number }) => {
    publish({ state: 'downloading', percent: Math.round(progress.percent) })
  })
  updater.on('update-downloaded', (info: { version: string }) => {
    if (verified !== info.version) {
      // The hook did not run (or passed another version): never let this
      // installer apply on quit.
      updater.autoInstallOnAppQuit = false
      refuse(info.version, 'downloaded update was not verified against the release signature')
      return
    }
    log('info', 'update downloaded and verified', { version: info.version })
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

  // The shell ships as an NSIS installer, so the Windows updater is what
  // electron-updater hands us; NsisUpdater exposes the signature hook.
  controller = createUpdateController(autoUpdater as NsisUpdater, notify)
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
