// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest'
import {
  createUpdateController,
  FOREGROUND_CHECK_INTERVAL_MS,
  type UpdaterClient
} from '../electron/main/updater'
import type { UpdateStatus } from '../shared/contract'

type UpdaterEvent = Parameters<UpdaterClient['on']>[0]
type Listener = Parameters<UpdaterClient['on']>[1]

class FakeUpdater implements UpdaterClient {
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdates = vi.fn(async (): Promise<void> => {})
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

describe('createUpdateController', () => {
  it('caches lifecycle events for a renderer that mounts after the launch check', () => {
    const updater = new FakeUpdater()
    const published: UpdateStatus[] = []
    const controller = createUpdateController(updater, (status) => published.push(status))

    expect(updater.autoDownload).toBe(true)
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
      () => time
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
    const controller = createUpdateController(updater, () => {})

    updater.emit('error', new Error('feed unreachable') as never)

    expect(controller.getStatus()).toEqual({ state: 'error', error: 'Error: feed unreachable' })
  })
})
