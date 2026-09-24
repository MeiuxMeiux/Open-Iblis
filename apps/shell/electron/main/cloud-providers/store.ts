// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  CLOUD_PROVIDER_IDS,
  type CloudDefaultTask,
  type CloudProviderId,
  type CloudTask,
  type ModelSummaryV1
} from '../../../shared/cloud-providers'
import { normalizeCachedModels } from './adapters'
import { ignoreFailure } from '../ignore-failure'

interface ProviderSettings {
  enabled: boolean
  consented: boolean
  tasks: Record<CloudTask, boolean>
  lastError?: string
}

export interface CloudSettingsDocument {
  version: 1
  providers: Record<CloudProviderId, ProviderSettings>
  defaults: Partial<Record<CloudDefaultTask, string>>
}

export interface ModelCacheEntry {
  etag?: string
  updatedAt: number
  models: ModelSummaryV1[]
}

export interface CloudStore {
  loadSettings(): Promise<CloudSettingsDocument>
  saveSettings(value: CloudSettingsDocument): Promise<void>
  loadCache(provider: CloudProviderId): Promise<ModelCacheEntry | null>
  saveCache(provider: CloudProviderId, value: ModelCacheEntry): Promise<void>
  loadKeys(): Promise<Partial<Record<CloudProviderId, string>>>
  saveKeys(value: Partial<Record<CloudProviderId, string>>): Promise<void>
}

const tasks = (): Record<CloudTask, boolean> => ({
  'song-ideas': false,
  'lyrics-assistance': false,
  'cover-generation': false
})

const providers: readonly CloudProviderId[] = CLOUD_PROVIDER_IDS
const cloudTasks: CloudTask[] = ['song-ideas', 'lyrics-assistance', 'cover-generation']

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

export function emptySettings(): CloudSettingsDocument {
  return {
    version: 1,
    providers: {
      openrouter: { enabled: false, consented: false, tasks: tasks() },
      imagerouter: { enabled: false, consented: false, tasks: tasks() }
    },
    defaults: {}
  }
}

// These files are userData, not a trusted IPC or network boundary. Parse them
// before either the host or renderer sees their contents so a stale/corrupt
// version cannot make a provider available, leak arbitrary fields, or crash
// the Settings view.
export function parseSettings(value: unknown): CloudSettingsDocument {
  const raw = object(value)
  if (raw?.version !== 1) return emptySettings()
  const parsed = emptySettings()
  const rawProviders = object(raw.providers)
  for (const provider of providers) {
    const source = object(rawProviders?.[provider])
    if (!source) continue
    const target = parsed.providers[provider]
    target.enabled = source.enabled === true
    target.consented = source.consented === true
    const rawTasks = object(source.tasks)
    for (const task of cloudTasks) {
      target.tasks[task] = target.consented && rawTasks?.[task] === true
    }
    const lastError = boundedText(source.lastError, 180)
    if (lastError) target.lastError = lastError
  }
  const rawDefaults = object(raw.defaults)
  for (const task of cloudTasks) {
    const modelId = boundedText(rawDefaults?.[task], 180)
    if (modelId) parsed.defaults[task] = modelId
  }
  return parsed
}

export function parseModelCache(provider: CloudProviderId, value: unknown): ModelCacheEntry | null {
  const raw = object(value)
  if (!raw || !Number.isSafeInteger(raw.updatedAt) || (raw.updatedAt as number) <= 0) return null
  if (!Array.isArray(raw.models)) return null
  const models = normalizeCachedModels(provider, raw.models)
  if (models.length === 0) return null
  const etag = boundedText(raw.etag, 256)
  return { updatedAt: raw.updatedAt as number, models, ...(etag ? { etag } : {}) }
}

export function parseKeys(value: unknown): Partial<Record<CloudProviderId, string>> {
  const raw = object(value)
  if (!raw) return {}
  const parsed: Partial<Record<CloudProviderId, string>> = {}
  for (const provider of providers) {
    const key = boundedText(raw[provider], 2048)
    if (key?.startsWith('enc:')) parsed[provider] = key
  }
  return parsed
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(file: string, value: unknown, mode?: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(value, null, 1), {
      encoding: 'utf8',
      ...(mode ? { mode } : {})
    })
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true }).catch(ignoreFailure)
    throw error
  }
}

export function createCloudStore(root: string): CloudStore {
  const settingsFile = `${root}/cloud-providers.json`
  const keysFile = `${root}/cloud-provider-keys.json`
  const cacheFile = (provider: CloudProviderId): string => `${root}/cloud-models-${provider}.json`
  return {
    async loadSettings() {
      return parseSettings(await readJson<unknown>(settingsFile))
    },
    saveSettings: (value) => writeJson(settingsFile, value),
    async loadCache(provider) {
      return parseModelCache(provider, await readJson<unknown>(cacheFile(provider)))
    },
    saveCache: (provider, value) => writeJson(cacheFile(provider), value),
    async loadKeys() {
      return parseKeys(await readJson<unknown>(keysFile))
    },
    // 0600: the blob is safeStorage-sealed, but keep it owner-only on
    // multi-user machines anyway.
    saveKeys: (value) => writeJson(keysFile, value, 0o600)
  }
}
