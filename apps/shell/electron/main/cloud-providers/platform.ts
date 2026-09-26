// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The host's two platform touch points, kept apart so the host itself stays
// testable with injected stand-ins: the installed signed adapter set and
// Electron safeStorage sealing.
import { safeStorage } from 'electron'
import type { CloudProviderId } from '../../../shared/cloud-providers'
import { listInstalled } from '../plugins/registry'
import { readInstalledManifest } from '../plugins/installed-manifest'

const ADAPTER_PLUGIN_IDS: Record<CloudProviderId, string> = {
  openrouter: 'mx.iblis.cloud.openrouter',
  imagerouter: 'mx.iblis.cloud.imagerouter'
}

export interface SecureStore {
  available(): boolean
  seal(value: string): string | null
  unseal(value: string): string | null
}

export function installedAdapters(): Set<CloudProviderId> {
  const providers = new Set<CloudProviderId>()
  for (const plugin of listInstalled()) {
    if (!plugin.activeVersion) continue
    const manifest = readInstalledManifest(plugin.id, plugin.activeVersion)
    if (manifest?.kind !== 'cloud-provider') continue
    const id = manifest.cloudProvider?.id
    if ((id === 'openrouter' || id === 'imagerouter') && plugin.id === ADAPTER_PLUGIN_IDS[id]) {
      providers.add(id)
    }
  }
  return providers
}

export function secureStorage(): SecureStore {
  return {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    },
    seal: (value) => {
      try {
        return safeStorage.isEncryptionAvailable()
          ? `enc:${safeStorage.encryptString(value).toString('base64')}`
          : null
      } catch {
        return null
      }
    },
    unseal: (value) => {
      if (!value.startsWith('enc:')) return null
      try {
        return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
      } catch {
        return null
      }
    }
  }
}
