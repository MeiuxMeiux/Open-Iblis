// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The Local model provider: any OpenAI-compatible server on this computer
// (Ollama, LM Studio, llama.cpp llama-server). No key. The address is one of
// three loopback host spellings plus a user-chosen port, and every URL is
// re-parsed and checked before a request leaves main, so a stored or crafted
// value can never point the helper at another machine.
import {
  LOCAL_HOSTS,
  type AssistProviderOption,
  type LocalHost,
  type LocalModelView
} from '../../../shared/text-assist'
import { cleanField } from '../../../shared/assist-prompts'
import { readJson, writeJson } from './store'
import { AssistError, requestJson } from './http'

const DEFAULT_PORT = 11434
const LIST_TIMEOUT_MS = 10_000
const LIST_MAX_BYTES = 256 * 1024
const MAX_MODELS = 200
const MAX_ID = 180
export const LOCAL_LABEL = 'The local model server'

interface LocalSettings {
  version: 1
  enabled: boolean
  host: LocalHost
  port: number
  models: string[]
  lastModel?: string
  lastError?: string
  lastCheckedAt?: number
}

export interface LocalStore {
  load(): Promise<unknown>
  save(value: LocalSettings): Promise<void>
}

export interface LocalModelHost {
  snapshot(): Promise<LocalModelView>
  configure(host: LocalHost, port: number): Promise<LocalModelView>
  setEnabled(enabled: boolean): Promise<LocalModelView>
  test(): Promise<LocalModelView>
  option(): Promise<AssistProviderOption>
  // The checked base URL for a generation with a listed model.
  endpoint(model: string): Promise<string>
  rememberModel(model: string): Promise<void>
}

function isLocalHost(value: unknown): value is LocalHost {
  return typeof value === 'string' && (LOCAL_HOSTS as readonly string[]).includes(value)
}

export function validPort(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value
  }
  throw new Error('enter a port from 1 to 65535')
}

// Parse, never prefix-match: userinfo, look-alike suffixes, and other hosts
// all fail here. http is acceptable only because the host is loopback.
export function loopbackUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('the local model address must be on this computer')
  }
  const local =
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    isLocalHost(url.hostname) &&
    url.username === '' &&
    url.password === ''
  if (!local) throw new Error('the local model address must be on this computer')
  return url
}

// "localhost" is dialled as 127.0.0.1 so a rewritten hosts file cannot move it.
export function localBase(host: LocalHost, port: number): string {
  const dial = host === 'localhost' ? '127.0.0.1' : host
  return loopbackUrl(`http://${dial}:${String(validPort(port))}`).origin
}

function defaults(): LocalSettings {
  return { version: 1, enabled: false, host: '127.0.0.1', port: DEFAULT_PORT, models: [] }
}

function modelId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = cleanField(value, MAX_ID + 1)
  return id && id.length <= MAX_ID ? id : null
}

function modelIds(values: unknown[]): string[] {
  const ids = values.map(modelId).filter((id): id is string => id !== null)
  return [...new Set(ids)].slice(0, MAX_MODELS)
}

export function parseLocalSettings(value: unknown): LocalSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const parsed = defaults()
  if (raw?.version !== 1) return parsed
  parsed.enabled = raw.enabled === true
  if (isLocalHost(raw.host)) parsed.host = raw.host
  try {
    parsed.port = validPort(raw.port)
  } catch {
    parsed.port = DEFAULT_PORT
  }
  if (Array.isArray(raw.models)) parsed.models = modelIds(raw.models)
  const lastModel = modelId(raw.lastModel)
  if (lastModel) parsed.lastModel = lastModel
  if (typeof raw.lastError === 'string' && raw.lastError.length <= 240) {
    parsed.lastError = raw.lastError
  }
  if (Number.isSafeInteger(raw.lastCheckedAt)) parsed.lastCheckedAt = raw.lastCheckedAt as number
  return parsed
}

// OpenAI shape: { data: [{ id }] }. Anything else yields no models.
export function parseModelList(raw: unknown): string[] {
  const data = raw && typeof raw === 'object' ? (raw as { data?: unknown }).data : undefined
  if (!Array.isArray(data)) return []
  return modelIds(
    data.map((entry) =>
      entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined
    )
  )
}

export function createLocalStore(root: string): LocalStore {
  const file = `${root}/local-model.json`
  return {
    load: () => readJson<unknown>(file),
    save: (value) => writeJson(file, value)
  }
}

export function createLocalModelHost(deps: {
  store: LocalStore
  fetch?: typeof fetch
  now?: () => number
}): LocalModelHost {
  const request = deps.fetch ?? fetch
  const now = deps.now ?? (() => Date.now())
  let settings: LocalSettings | null = null

  async function load(): Promise<LocalSettings> {
    settings ??= parseLocalSettings(await deps.store.load())
    return settings
  }

  function view(value: LocalSettings): LocalModelView {
    return {
      enabled: value.enabled,
      host: value.host,
      port: value.port,
      models: [...value.models],
      ...(value.lastModel ? { lastModel: value.lastModel } : {}),
      ...(value.lastError ? { lastError: value.lastError } : {}),
      ...(value.lastCheckedAt ? { lastCheckedAt: value.lastCheckedAt } : {})
    }
  }

  async function save(value: LocalSettings): Promise<LocalModelView> {
    await deps.store.save(value)
    return view(value)
  }

  async function listModels(value: LocalSettings): Promise<string[]> {
    const url = loopbackUrl(`${localBase(value.host, value.port)}/v1/models`)
    const models = parseModelList(
      await requestJson({
        fetch: request,
        url: url.href,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeoutMs: LIST_TIMEOUT_MS,
        maxBytes: LIST_MAX_BYTES,
        label: LOCAL_LABEL,
        local: true
      })
    )
    if (models.length === 0) {
      throw new AssistError(
        'The local server answered but lists no models. Load or pull a model first.'
      )
    }
    return models
  }

  return {
    snapshot: async () => view(await load()),
    async configure(host, port) {
      const value = await load()
      if (!isLocalHost(host)) throw new Error('the local model address must be on this computer')
      const checked = validPort(port)
      if (value.host !== host || value.port !== checked) {
        Object.assign(value, { host, port: checked, models: [] })
        delete value.lastError
        delete value.lastCheckedAt
      }
      return save(value)
    },
    async setEnabled(enabled) {
      const value = await load()
      value.enabled = enabled
      return save(value)
    },
    async test() {
      const value = await load()
      if (!value.enabled) throw new Error('turn on Local model first')
      try {
        value.models = await listModels(value)
        delete value.lastError
      } catch (error) {
        value.lastError =
          error instanceof AssistError
            ? error.message
            : 'The local model server could not be reached.'
        value.lastCheckedAt = now()
        await save(value)
        throw new AssistError(value.lastError, { cause: error })
      }
      value.lastCheckedAt = now()
      return save(value)
    },
    async option() {
      const value = await load()
      const reason = !value.enabled
        ? 'Turn on Local model in Settings, then Test connection.'
        : value.models.length === 0
          ? 'Use Test connection in Settings, Local model, to list your models.'
          : undefined
      return {
        id: 'local',
        name: 'Local model',
        available: reason === undefined,
        ...(reason ? { reason } : {}),
        models: value.models.map((id) => ({ id, name: id, free: true })),
        ...(value.lastModel && value.models.includes(value.lastModel)
          ? { defaultModel: value.lastModel }
          : {})
      }
    },
    async endpoint(model) {
      const value = await load()
      if (!value.enabled) throw new AssistError('Turn on Local model in Settings first.')
      if (!value.models.includes(model)) {
        throw new AssistError('Pick a model from the listed local models.')
      }
      return localBase(value.host, value.port)
    },
    async rememberModel(model) {
      const value = await load()
      if (value.lastModel === model) return
      value.lastModel = model
      await deps.store.save(value)
    }
  }
}
