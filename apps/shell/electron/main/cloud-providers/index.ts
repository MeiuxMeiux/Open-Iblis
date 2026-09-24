// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, safeStorage } from 'electron'
import {
  CLOUD_PROVIDER_IDS,
  type CloudDefaultTask,
  type CloudProviderId,
  type CloudProviderView,
  type CloudProvidersSnapshot,
  type CloudTask,
  type ModelSummaryV1
} from '../../../shared/cloud-providers'
import { listInstalled } from '../plugins/registry'
import { readInstalledManifest } from '../plugins/installed-manifest'
import { log } from '../logger'
import { modelUrl, normalizeModels, PROVIDER_NAMES } from './adapters'
import {
  createCloudStore,
  parseKeys,
  parseModelCache,
  parseSettings,
  type CloudSettingsDocument,
  type CloudStore
} from './store'
import { errorMessage } from '../error-message'

const PROVIDERS: readonly CloudProviderId[] = CLOUD_PROVIDER_IDS
const ADAPTER_PLUGIN_IDS: Record<CloudProviderId, string> = {
  openrouter: 'mx.iblis.cloud.openrouter',
  imagerouter: 'mx.iblis.cloud.imagerouter'
}
const PROVIDER_TASKS: Record<CloudProviderId, CloudTask[]> = {
  openrouter: ['song-ideas', 'lyrics-assistance'],
  imagerouter: ['cover-generation']
}
const DAY = 86_400_000
const TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 2_000_000

interface SecureStore {
  available(): boolean
  seal(value: string): string | null
  unseal(value: string): string | null
}

interface HostDeps {
  store: CloudStore
  secure: SecureStore
  now?: () => number
  fetch?: typeof fetch
  installed?: () => Set<CloudProviderId>
}

export interface CloudProviderHost {
  snapshot(): Promise<CloudProvidersSnapshot>
  saveKey(provider: CloudProviderId, key: string): Promise<CloudProvidersSnapshot>
  removeKey(provider: CloudProviderId): Promise<CloudProvidersSnapshot>
  test(provider: CloudProviderId): Promise<CloudProvidersSnapshot>
  refreshModels(provider: CloudProviderId): Promise<CloudProvidersSnapshot>
  setEnabled(provider: CloudProviderId, enabled: boolean): Promise<CloudProvidersSnapshot>
  acknowledgeConsent(provider: CloudProviderId): Promise<CloudProvidersSnapshot>
  setTask(
    provider: CloudProviderId,
    task: CloudTask,
    enabled: boolean
  ): Promise<CloudProvidersSnapshot>
  setDefault(task: CloudDefaultTask, modelId?: string): Promise<CloudProvidersSnapshot>
}

function installedAdapters(): Set<CloudProviderId> {
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

function secureStorage(): SecureStore {
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

function validKey(value: string): string {
  const key = value.trim()
  if (!key || key.length > 512 || /[\r\n\0]/.test(key)) throw new Error('enter a valid API key')
  return key
}

function allModels(caches: Map<CloudProviderId, ModelSummaryV1[]>): ModelSummaryV1[] {
  return PROVIDERS.flatMap((provider) => caches.get(provider) ?? [])
}

export function createCloudProviderHost(deps: HostDeps): CloudProviderHost {
  const now = deps.now ?? (() => Date.now())
  const request = deps.fetch ?? fetch
  const adapters = deps.installed ?? installedAdapters
  let settings: CloudSettingsDocument | null = null
  let keys: Partial<Record<CloudProviderId, string>> | null = null
  const caches = new Map<
    CloudProviderId,
    { etag?: string; updatedAt: number; models: ModelSummaryV1[] }
  >()

  async function load(): Promise<void> {
    settings ??= parseSettings(await deps.store.loadSettings())
    keys ??= parseKeys(await deps.store.loadKeys())
    for (const provider of PROVIDERS) {
      if (caches.has(provider)) continue
      const cache = parseModelCache(provider, await deps.store.loadCache(provider))
      if (cache) caches.set(provider, cache)
    }
  }

  // Every public entry point awaits load() first, so these hold afterwards.
  function loadedSettings(): CloudSettingsDocument {
    if (settings === null) throw new Error('cloud provider settings used before load')
    return settings
  }

  function loadedKeys(): Partial<Record<CloudProviderId, string>> {
    if (keys === null) throw new Error('cloud provider keys used before load')
    return keys
  }

  function hasKey(provider: CloudProviderId): boolean {
    return deps.secure.unseal(keys?.[provider] ?? '') !== null
  }

  function view(provider: CloudProviderId): CloudProviderView {
    const providerSettings = loadedSettings().providers[provider]
    const cache = caches.get(provider)
    const offline = !!cache && now() - cache.updatedAt > DAY
    let status: CloudProviderView['status']
    if (!deps.secure.available()) status = 'secure-storage-unavailable'
    else if (!adapters().has(provider)) status = 'adapter-unavailable'
    else if (!providerSettings.enabled) status = 'disabled'
    else if (!hasKey(provider)) status = 'needs-key'
    else if (providerSettings.lastError && cache) status = 'offline-cache'
    else if (providerSettings.lastError) status = 'test-failed'
    else if (offline) status = 'offline-cache'
    else status = 'ready'
    return {
      id: provider,
      name: PROVIDER_NAMES[provider],
      status,
      enabled: providerSettings.enabled,
      hasKey: hasKey(provider),
      tasks: { ...providerSettings.tasks },
      consented: providerSettings.consented,
      ...(providerSettings.lastError ? { lastError: providerSettings.lastError } : {}),
      ...(cache ? { lastUpdatedAt: cache.updatedAt } : {}),
      cacheState: !cache
        ? 'empty'
        : providerSettings.lastError
          ? 'offline'
          : offline
            ? 'stale'
            : 'fresh'
    }
  }

  async function result(): Promise<CloudProvidersSnapshot> {
    await load()
    return {
      secureStorageAvailable: deps.secure.available(),
      providers: PROVIDERS.map(view),
      models: allModels(new Map([...caches].map(([id, cache]) => [id, cache.models]))),
      defaults: { ...loadedSettings().defaults }
    }
  }

  async function saveSettings(): Promise<void> {
    await deps.store.saveSettings(loadedSettings())
  }

  async function bearer(provider: CloudProviderId): Promise<string> {
    await load()
    if (!deps.secure.available())
      throw new Error('secure key storage is unavailable on this system')
    if (!adapters().has(provider))
      throw new Error(`${PROVIDER_NAMES[provider]} adapter is not installed`)
    if (!loadedSettings().providers[provider].enabled)
      throw new Error(`${PROVIDER_NAMES[provider]} is disabled`)
    const key = deps.secure.unseal(keys?.[provider] ?? '')
    if (!key) throw new Error(`add a ${PROVIDER_NAMES[provider]} API key first`)
    return key
  }

  async function fetchModels(provider: CloudProviderId): Promise<ModelSummaryV1[]> {
    const key = await bearer(provider)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const cached = caches.get(provider)
      const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json'
      }
      if (cached?.etag) headers['If-None-Match'] = cached.etag
      const response = await request(modelUrl(provider), {
        headers,
        redirect: 'error',
        signal: ctrl.signal
      })
      if (response.status === 304 && cached) {
        const cache = { ...cached, updatedAt: now() }
        caches.set(provider, cache)
        await deps.store.saveCache(provider, cache)
        loadedSettings().providers[provider].lastError = undefined
        await saveSettings()
        return cache.models
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const length = Number(response.headers.get('content-length') ?? '0')
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)
        throw new Error('model response exceeds size limit')
      const raw = await response.text()
      if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES)
        throw new Error('model response exceeds size limit')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error('provider returned invalid model data')
      }
      const models = normalizeModels(provider, parsed)
      if (models.length === 0) throw new Error('provider returned no usable models')
      const etag = response.headers.get('etag')
      const cache = { updatedAt: now(), models, ...(etag && etag.length <= 256 ? { etag } : {}) }
      caches.set(provider, cache)
      await deps.store.saveCache(provider, cache)
      loadedSettings().providers[provider].lastError = undefined
      await saveSettings()
      return models
    } finally {
      clearTimeout(timer)
    }
  }

  async function recordFailure(provider: CloudProviderId, cause: unknown): Promise<void> {
    await load()
    // Provider errors are deliberately generic: never persist URL fragments,
    // response text, or a request header which could contain a credential.
    loadedSettings().providers[provider].lastError = errorMessage(cause).slice(0, 180)
    await saveSettings()
  }

  return {
    snapshot: result,
    async saveKey(provider, rawKey) {
      await load()
      if (!deps.secure.available())
        throw new Error('secure key storage is unavailable on this system')
      const sealed = deps.secure.seal(validKey(rawKey))
      if (!sealed) throw new Error('secure key storage is unavailable on this system')
      loadedKeys()[provider] = sealed
      loadedSettings().providers[provider].lastError = undefined
      await Promise.all([deps.store.saveKeys(loadedKeys()), saveSettings()])
      return result()
    },
    async removeKey(provider) {
      await load()
      delete loadedKeys()[provider]
      loadedSettings().providers[provider].lastError = undefined
      await Promise.all([deps.store.saveKeys(loadedKeys()), saveSettings()])
      return result()
    },
    async test(provider) {
      try {
        await fetchModels(provider)
      } catch (error) {
        await recordFailure(provider, error)
        throw error
      }
      return result()
    },
    async refreshModels(provider) {
      try {
        await fetchModels(provider)
      } catch (error) {
        await recordFailure(provider, error)
        throw error
      }
      return result()
    },
    async setEnabled(provider, enabled) {
      await load()
      loadedSettings().providers[provider].enabled = enabled
      await saveSettings()
      return result()
    },
    async acknowledgeConsent(provider) {
      await load()
      loadedSettings().providers[provider].consented = true
      await saveSettings()
      return result()
    },
    async setTask(provider, task, enabled) {
      await load()
      if (!PROVIDER_TASKS[provider].includes(task)) {
        throw new Error(`${PROVIDER_NAMES[provider]} does not provide this capability`)
      }
      if (enabled && !loadedSettings().providers[provider].consented) {
        throw new Error(
          'read and acknowledge the cloud privacy disclosure before enabling a capability'
        )
      }
      loadedSettings().providers[provider].tasks[task] = enabled
      await saveSettings()
      return result()
    },
    async setDefault(task, modelId) {
      await load()
      if (!modelId) delete loadedSettings().defaults[task]
      else {
        const model = allModels(new Map([...caches].map(([id, cache]) => [id, cache.models]))).find(
          (candidate) => candidate.id === modelId
        )
        if (!model) throw new Error('select a model from the cached registry')
        const provider = task === 'cover-generation' ? 'imagerouter' : 'openrouter'
        if (model.provider !== provider) {
          throw new Error(`select a ${PROVIDER_NAMES[provider]} model for this default`)
        }
        if (task === 'cover-generation' && !model.outputModalities.includes('image')) {
          throw new Error('cover default must be an image model')
        }
        if (task !== 'cover-generation' && !model.outputModalities.includes('text')) {
          throw new Error('idea and lyrics defaults must be text models')
        }
        loadedSettings().defaults[task] = modelId
      }
      await saveSettings()
      return result()
    }
  }
}

let host: CloudProviderHost | null = null

export function initializeCloudProviderHost(): void {
  if (host) return
  host = createCloudProviderHost({
    store: createCloudStore(app.getPath('userData')),
    secure: secureStorage()
  })
  log('info', 'cloud provider host initialized', { component: 'cloud-providers' })
}

export function cloudProviderHost(): CloudProviderHost {
  if (!host) throw new Error('cloud provider host is not initialized')
  return host
}
