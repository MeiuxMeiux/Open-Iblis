// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { ipcMain } from 'electron'
import {
  CLOUD_PROVIDER_IDS,
  type CloudProviderId,
  type CloudTask
} from '../../shared/cloud-providers'
import { cloudProviderHost } from './cloud-providers'
import { guardAsync } from './ipc-guard'

function provider(value: unknown): CloudProviderId {
  if (typeof value === 'string' && CLOUD_PROVIDER_IDS.includes(value as CloudProviderId)) {
    return value as CloudProviderId
  }
  throw new Error('invalid cloud provider')
}

function task(value: unknown): CloudTask {
  if (value === 'song-ideas' || value === 'lyrics-assistance' || value === 'cover-generation') {
    return value
  }
  throw new Error('invalid cloud task')
}

function enabled(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  throw new Error('invalid enabled value')
}

// Shape check only. Content validation (trim, length cap, control chars)
// is the host's job — validKey() in cloud-providers/index.ts is authoritative.
function key(value: unknown): string {
  if (typeof value === 'string') return value
  throw new Error('enter a valid API key')
}

function modelId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.length <= 180) return value
  throw new Error('invalid model selection')
}

export function registerCloudProviderIpc(): void {
  ipcMain.handle('cloud-providers:snapshot', () => guardAsync(() => cloudProviderHost().snapshot()))
  ipcMain.handle('cloud-providers:save-key', (_e, rawProvider: unknown, rawKey: unknown) =>
    guardAsync(() => {
      const providerId = provider(rawProvider)
      const apiKey = key(rawKey)
      return cloudProviderHost().saveKey(providerId, apiKey)
    })
  )
  ipcMain.handle('cloud-providers:remove-key', (_e, rawProvider: unknown) =>
    guardAsync(() => {
      const providerId = provider(rawProvider)
      return cloudProviderHost().removeKey(providerId)
    })
  )
  ipcMain.handle('cloud-providers:test', (_e, rawProvider: unknown) =>
    guardAsync(() => {
      const providerId = provider(rawProvider)
      return cloudProviderHost().test(providerId)
    })
  )
  ipcMain.handle('cloud-providers:refresh-models', (_e, rawProvider: unknown) =>
    guardAsync(() => {
      const providerId = provider(rawProvider)
      return cloudProviderHost().refreshModels(providerId)
    })
  )
  ipcMain.handle('cloud-providers:set-enabled', (_e, rawProvider: unknown, rawEnabled: unknown) =>
    guardAsync(() => {
      const providerId = provider(rawProvider)
      const isEnabled = enabled(rawEnabled)
      return cloudProviderHost().setEnabled(providerId, isEnabled)
    })
  )
  ipcMain.handle('cloud-providers:acknowledge-consent', (_e, rawProvider: unknown) =>
    guardAsync(() => {
      const providerId = provider(rawProvider)
      return cloudProviderHost().acknowledgeConsent(providerId)
    })
  )
  ipcMain.handle(
    'cloud-providers:set-task',
    (_e, rawProvider: unknown, rawTask: unknown, rawEnabled: unknown) =>
      guardAsync(() => {
        const providerId = provider(rawProvider)
        const cloudTask = task(rawTask)
        const isEnabled = enabled(rawEnabled)
        return cloudProviderHost().setTask(providerId, cloudTask, isEnabled)
      })
  )
  ipcMain.handle('cloud-providers:set-default', (_e, rawTask: unknown, rawModelId?: unknown) =>
    guardAsync(() => {
      const defaultTask = task(rawTask)
      const selectedModelId = modelId(rawModelId)
      return cloudProviderHost().setDefault(defaultTask, selectedModelId)
    })
  )
}
