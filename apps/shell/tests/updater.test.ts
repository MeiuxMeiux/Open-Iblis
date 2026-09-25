// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest'
import {
  createUpdateController,
  FOREGROUND_CHECK_INTERVAL_MS,
  type SignatureDeps,
  type UpdaterClient,
  type VerifyHook
} from '../electron/main/updater'
import type { UpdateStatus } from '../shared/contract'
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  installerFileName,
  releaseSignatureMessage,
  type ReleaseSignature
} from '../electron/main/release-signature'

type UpdaterEvent = Parameters<UpdaterClient['on']>[0]
type Listener = Parameters<UpdaterClient['on']>[1]

class FakeUpdater implements UpdaterClient {
  autoDownload = true
  autoInstallOnAppQuit = false
  verifyUpdateCodeSignature: VerifyHook = async () => 'unset'
  checkForUpdates = vi.fn(async (): Promise<void> => {})
  downloadUpdate = vi.fn(async (): Promise<void> => {})
  quitAndInstall = vi.fn()
  private readonly listeners = new Map<UpdaterEvent, Listener[]>()

  on(event: UpdaterEvent, listener: Listener): this {
    const callbacks = this.listeners.get(event) ?? []
    callbacks.push(listener)
    this.listeners.set(event, callbacks)
    return this
  }

  emit(event: UpdaterEvent, ...args: never[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

// A throwaway release key stands in for the shipped one (deps.pubKeyPem); one
// test leaves the default in place to prove a foreign signature is refused.
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string
const VERSION = '0.2.0-alpha.54'
const SHA = Buffer.alloc(64, 1).toString('base64')

function doc(version = VERSION, sha512 = SHA): ReleaseSignature {
  const file = installerFileName(version)
  const sig = sign(null, releaseSignatureMessage(version, file, sha512), privateKey).toString(
    'base64'
  )
  return { version, file, sha512, sig }
}

function deps(overrides: Partial<SignatureDeps> = {}): SignatureDeps {
  return {
    fetchSignature: vi.fn(async () => ({ kind: 'ok' as const, signature: doc() })),
    hashFile: vi.fn(async () => SHA),
    pubKeyPem: PUB_PEM,
    ...overrides
  }
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('createUpdateController', () => {
  it('caches lifecycle events for a renderer that mounts after the launch check', () => {
    const updater = new FakeUpdater()
    const published: UpdateStatus[] = []
    const controller = createUpdateController(
      updater,
      (status) => published.push(status),
      Date.now,
      deps()
    )

    // Downloads wait for the release signature; installs still apply on quit.
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(true)

    updater.emit('checking-for-update')
    updater.emit('update-not-available')

    expect(published).toEqual([{ state: 'checking' }, { state: 'current' }])
    expect(controller.getStatus()).toEqual({ state: 'current' })
  })

  it('makes a user-requested check immediately and foreground checks no more than once per bound', async () => {
    let time = 0
    const updater = new FakeUpdater()
    const controller = createUpdateController(
      updater,
      () => {},
      () => time,
      deps()
    )

    await controller.checkNow()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    time = FOREGROUND_CHECK_INTERVAL_MS - 1
    controller.checkIfDue()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    time = FOREGROUND_CHECK_INTERVAL_MS
    controller.checkIfDue()
    await Promise.resolve()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('reports an updater error without exposing updater work to the renderer', () => {
    const updater = new FakeUpdater()
    const controller = createUpdateController(updater, () => {}, Date.now, deps())

    updater.emit('error', new Error('feed unreachable') as never)

    expect(controller.getStatus()).toEqual({ state: 'error', error: 'Error: feed unreachable' })
  })

  it('waits, without downloading, while the release signature is not published yet', async () => {
    const updater = new FakeUpdater()
    const published: UpdateStatus[] = []
    createUpdateController(
      updater,
      (s) => published.push(s),
      Date.now,
      deps({ fetchSignature: vi.fn(async () => ({ kind: 'missing' as const })) })
    )

    updater.emit('update-available', { version: VERSION } as never)
    await flush()

    expect(published).toEqual([
      { state: 'available', version: VERSION },
      { state: 'pending', version: VERSION }
    ])
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('refuses before downloading when the feed and the signature disagree, or the signature is bad', async () => {
    const updater = new FakeUpdater()
    const published: UpdateStatus[] = []
    createUpdateController(updater, (s) => published.push(s), Date.now, deps())

    updater.emit('update-available', { version: VERSION, files: [{ sha512: 'other' }] } as never)
    await flush()
    expect(published.at(-1)).toEqual({
      state: 'error',
      error: 'update feed and release signature disagree'
    })

    // Signed by a key that is not the shipped release key (default pubKeyPem).
    const foreign = new FakeUpdater()
    const refused: UpdateStatus[] = []
    createUpdateController(
      foreign,
      (s) => refused.push(s),
      Date.now,
      deps({ pubKeyPem: undefined })
    )
    foreign.emit('update-available', { version: VERSION, files: [{ sha512: SHA }] } as never)
    await flush()
    expect(refused.at(-1)).toEqual({ state: 'error', error: 'release signature does not verify' })
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(foreign.downloadUpdate).not.toHaveBeenCalled()
  })

  it('surfaces a signature fetch failure and a download rejection as errors', async () => {
    const updater = new FakeUpdater()
    const published: UpdateStatus[] = []
    createUpdateController(
      updater,
      (s) => published.push(s),
      Date.now,
      deps({
        fetchSignature: vi.fn(async () => ({ kind: 'error' as const, message: 'timed out' }))
      })
    )
    updater.emit('update-available', { version: VERSION } as never)
    await flush()
    expect(published.at(-1)).toEqual({ state: 'error', error: 'timed out' })

    const rejecting = new FakeUpdater()
    const later: UpdateStatus[] = []
    createUpdateController(
      rejecting,
      (s) => later.push(s),
      Date.now,
      deps({
        fetchSignature: vi.fn(async () => {
          throw new Error('boom')
        })
      })
    )
    rejecting.emit('update-available', { version: VERSION } as never)
    await flush()
    expect(later.at(-1)).toEqual({ state: 'error', error: 'Error: boom' })
  })

  it('never reports a downloaded installer as ready unless the hook verified that version', async () => {
    const updater = new FakeUpdater()
    const published: UpdateStatus[] = []
    createUpdateController(updater, (s) => published.push(s), Date.now, deps())

    // No approved signature at all: the hook refuses and the file is refused.
    expect(await updater.verifyUpdateCodeSignature(['Meiux Meiux LLC'], '/tmp/x.exe')).toMatch(
      /no release signature/
    )

    updater.emit('update-downloaded', { version: VERSION } as never)
    expect(published.at(-1)).toEqual({
      state: 'error',
      error: 'downloaded update was not verified against the release signature'
    })
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })

  it('downloads once the signature checks out, then reports ready only after the hook verifies the bytes', async () => {
    const updater = new FakeUpdater()
    const published: UpdateStatus[] = []
    const hashFile = vi.fn(async () => SHA)
    const controller = createUpdateController(
      updater,
      (s) => published.push(s),
      Date.now,
      deps({ hashFile })
    )

    updater.emit('update-available', { version: VERSION, files: [{ sha512: SHA }] } as never)
    await flush()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)

    updater.emit('download-progress', { percent: 42.4 } as never)
    expect(controller.getStatus()).toEqual({ state: 'downloading', percent: 42 })

    // Downloaded bytes that hash differently are refused by the hook.
    hashFile.mockResolvedValueOnce(Buffer.alloc(64, 9).toString('base64'))
    expect(await updater.verifyUpdateCodeSignature(['Meiux Meiux LLC'], '/tmp/x.exe')).toMatch(
      /do not match/
    )
    // The right bytes pass, and only then does the download count as ready.
    expect(await updater.verifyUpdateCodeSignature(['Meiux Meiux LLC'], '/tmp/x.exe')).toBeNull()
    updater.emit('update-downloaded', { version: VERSION } as never)
    expect(published.at(-1)).toEqual({ state: 'ready', version: VERSION })
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })
})
