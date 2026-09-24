// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Public, deliberately small view of the optional Cloud Provider Host. Keys,
// raw provider replies, and request bodies never cross this boundary.
import type { IpcResult } from './contract'

export const CLOUD_PROVIDER_IDS = ['openrouter', 'imagerouter'] as const
export type CloudProviderId = (typeof CLOUD_PROVIDER_IDS)[number]
export type CloudTask = 'song-ideas' | 'lyrics-assistance' | 'cover-generation'
export type CloudDefaultTask = 'song-ideas' | 'lyrics-assistance' | 'cover-generation'
type CloudProviderStatus =
  | 'disabled'
  | 'needs-key'
  | 'ready'
  | 'test-failed'
  | 'offline-cache'
  | 'adapter-unavailable'
  | 'secure-storage-unavailable'

interface ModelPriceV1 {
  inputPerMillion?: number
  outputPerMillion?: number
  min?: number
  typical?: number
  max?: number
}

export interface ModelSummaryV1 {
  schemaVersion: 1
  provider: CloudProviderId
  id: string
  name: string
  inputModalities: string[]
  outputModalities: string[]
  contextWindow?: number
  maxOutput?: number
  supportedParameters: string[]
  sizes: string[]
  price?: ModelPriceV1
  free: boolean
  privacyLabel: string
}

export interface CloudProviderView {
  id: CloudProviderId
  name: string
  status: CloudProviderStatus
  enabled: boolean
  hasKey: boolean
  tasks: Record<CloudTask, boolean>
  consented: boolean
  lastError?: string
  lastUpdatedAt?: number
  cacheState: 'empty' | 'fresh' | 'stale' | 'offline'
}

export interface CloudProvidersSnapshot {
  secureStorageAvailable: boolean
  providers: CloudProviderView[]
  models: ModelSummaryV1[]
  defaults: Partial<Record<CloudDefaultTask, string>>
}

export interface CloudProvidersApi {
  cloudProviders: {
    snapshot: () => Promise<IpcResult<CloudProvidersSnapshot>>
    saveKey: (provider: CloudProviderId, key: string) => Promise<IpcResult<CloudProvidersSnapshot>>
    removeKey: (provider: CloudProviderId) => Promise<IpcResult<CloudProvidersSnapshot>>
    test: (provider: CloudProviderId) => Promise<IpcResult<CloudProvidersSnapshot>>
    refreshModels: (provider: CloudProviderId) => Promise<IpcResult<CloudProvidersSnapshot>>
    setEnabled: (
      provider: CloudProviderId,
      enabled: boolean
    ) => Promise<IpcResult<CloudProvidersSnapshot>>
    acknowledgeConsent: (provider: CloudProviderId) => Promise<IpcResult<CloudProvidersSnapshot>>
    setTask: (
      provider: CloudProviderId,
      task: CloudTask,
      enabled: boolean
    ) => Promise<IpcResult<CloudProvidersSnapshot>>
    setDefault: (
      task: CloudDefaultTask,
      modelId?: string
    ) => Promise<IpcResult<CloudProvidersSnapshot>>
  }
}
