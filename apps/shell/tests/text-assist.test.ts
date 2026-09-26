// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Text assistance (Song idea / Write lyrics): the loopback guard, bounded
// replies, one request per task, cancel, key redaction, and the OpenRouter
// routing policy. No test reaches a third party: OpenRouter is an injected
// fetch and the local provider is a throwaway server on 127.0.0.1.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { ipcMain } from 'electron'
import { createCloudProviderHost } from '../electron/main/cloud-providers'
import { emptySettings, type CloudStore } from '../electron/main/cloud-providers/store'
import {
  createLocalModelHost,
  localBase,
  loopbackUrl,
  parseLocalSettings,
  parseModelList,
  type LocalStore
} from '../electron/main/cloud-providers/local'
import { createTextAssist } from '../electron/main/cloud-providers/generate'
import { requestJson } from '../electron/main/cloud-providers/http'
import { assistRequest, registerTextAssistIpc } from '../electron/main/ipc-text-assist'
import { cleanOutput, estimateUsd } from '../shared/assist-prompts'
import type { AssistRequest } from '../shared/text-assist'
import type { CloudProviderId } from '../shared/cloud-providers'

const SECRET = 'sk-test-secret-value'
const servers: { close(): void }[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

async function localServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ port: number; paths: string[] }> {
  const paths: string[] = []
  const server = createServer((req, res) => {
    paths.push(req.url ?? '')
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push({ close: () => server.close() })
  return { port: (server.address() as AddressInfo).port, paths }
}

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function localStore(): LocalStore & { value: unknown } {
  return {
    value: null,
    async load() {
      return this.value
    },
    async save(value) {
      this.value = JSON.parse(JSON.stringify(value)) as unknown
    }
  }
}

function cloudStore(): CloudStore {
  let settings = emptySettings()
  let keys: Partial<Record<CloudProviderId, string>> = {}
  const caches = new Map<CloudProviderId, Awaited<ReturnType<CloudStore['loadCache']>>>()
  return {
    loadSettings: async () => settings,
    saveSettings: async (value) => {
      settings = JSON.parse(JSON.stringify(value)) as typeof settings
    },
    loadCache: async (provider) => caches.get(provider) ?? null,
    saveCache: async (provider, value) => {
      caches.set(provider, value)
    },
    loadKeys: async () => keys,
    saveKeys: async (value) => {
      keys = { ...value }
    }
  }
}

const secure = {
  available: () => true,
  seal: (key: string) => `enc:${Buffer.from(key).toString('base64')}`,
  unseal: (value: string) =>
    value.startsWith('enc:') ? Buffer.from(value.slice(4), 'base64').toString() : null
}

// An OpenRouter host that is enabled, keyed, consented, has both text tasks
// on, and holds one cached text model.
async function readyCloud() {
  const host = createCloudProviderHost({
    store: cloudStore(),
    secure,
    installed: () => new Set<CloudProviderId>(['openrouter']),
    fetch: async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'example/writer',
              name: 'Example Writer',
              architecture: { output_modalities: ['text'] },
              pricing: { prompt: '0.000001', completion: '0.000002' }
            }
          ]
        })
      )
  })
  await host.saveKey('openrouter', SECRET)
  await host.setEnabled('openrouter', true)
  await host.acknowledgeConsent('openrouter')
  await host.setTask('openrouter', 'song-ideas', true)
  await host.setTask('openrouter', 'lyrics-assistance', true)
  await host.refreshModels('openrouter')
  return host
}

async function readyLocal(port: number) {
  const local = createLocalModelHost({ store: localStore() })
  await local.setEnabled(true)
  await local.configure('127.0.0.1', port)
  return local
}

const idea = (provider: 'openrouter' | 'local', model: string): AssistRequest => ({
  task: 'song-ideas',
  provider,
  model,
  brief: { seed: 'rainy night drive' }
})

const reply = (content: string) => ({ choices: [{ message: { role: 'assistant', content } }] })

describe('local model loopback guard', () => {
  it('accepts only the three loopback spellings', () => {
    expect(loopbackUrl('http://127.0.0.1:11434/v1/models').hostname).toBe('127.0.0.1')
    expect(loopbackUrl('http://localhost:1234').hostname).toBe('localhost')
    expect(loopbackUrl('http://[::1]:8080').hostname).toBe('[::1]')
    expect(localBase('[::1]', 8080)).toBe('http://[::1]:8080')
    expect(localBase('localhost', 11434)).toBe('http://127.0.0.1:11434')
  })

  it.each([
    'http://10.0.0.1:11434',
    'http://127.0.0.1.evil.example:11434',
    'http://127.0.0.1@evil.example/',
    'http://user@127.0.0.1:11434',
    'http://evil.example@127.0.0.1:11434',
    'https://example.com/v1/models',
    'http://example.com',
    'http://127.0.0.2:11434',
    'http://0.0.0.0:11434',
    'ftp://127.0.0.1/',
    'file:///etc/hosts',
    'not a url'
  ])('refuses %s', (url) => {
    expect(() => loopbackUrl(url)).toThrow('must be on this computer')
  })

  it('refuses a loopback URL carrying a password', () => {
    const url = new URL('http://127.0.0.1:11434/v1/models')
    url.password = 'x'
    expect(() => loopbackUrl(url.href)).toThrow('must be on this computer')
  })

  it('refuses bad ports and non-loopback hosts at the IPC boundary', async () => {
    registerTextAssistIpc()
    const handlers = (ipcMain as unknown as { handlers: Map<string, (...a: unknown[]) => unknown> })
      .handlers
    const configure = handlers.get('local-model:configure')
    await expect(configure?.({}, '10.0.0.1', 11434)).resolves.toEqual({
      ok: false,
      error: 'the local model address must be on this computer'
    })
    await expect(configure?.({}, '127.0.0.1', 70000)).resolves.toMatchObject({ ok: false })
    expect(() => localBase('127.0.0.1', 0)).toThrow('port')
    expect(parseLocalSettings({ version: 1, host: 'evil.example', port: -1 })).toMatchObject({
      host: '127.0.0.1',
      port: 11434,
      enabled: false
    })
  })

  it('refuses a redirect from the local server without following it', async () => {
    const server = await localServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' })
      res.end()
    })
    const local = await readyLocal(server.port)
    await expect(local.test()).rejects.toThrow('redirect')
    expect(server.paths).toEqual(['/v1/models'])
  })
})

describe('bounded replies', () => {
  it('lists local models and bounds the list', async () => {
    const server = await localServer((_req, res) =>
      json(res, { data: [{ id: 'llama3' }, { id: 'qwen\u0007' }, { id: 7 }, { id: 'llama3' }] })
    )
    const local = await readyLocal(server.port)
    expect((await local.test()).models).toEqual(['llama3', 'qwen'])
    expect(
      parseModelList({ data: Array.from({ length: 500 }, (_, i) => ({ id: `m${String(i)}` })) })
    ).toHaveLength(200)
    expect(parseModelList({ models: [] })).toEqual([])
  })

  it('refuses an oversized body, declared or streamed', async () => {
    const big = 'x'.repeat(300 * 1024)
    const server = await localServer((req, res) => {
      if (req.url === '/declared') {
        res.writeHead(200, { 'content-length': String(big.length) })
      } else res.writeHead(200)
      res.end(big)
    })
    for (const path of ['/declared', '/streamed']) {
      await expect(
        requestJson({
          fetch,
          url: `http://127.0.0.1:${String(server.port)}${path}`,
          method: 'GET',
          headers: {},
          timeoutMs: 5000,
          maxBytes: 256 * 1024,
          label: 'Test server',
          local: true
        })
      ).rejects.toThrow('larger than Iblis accepts')
    }
  })

  it('times out calmly', async () => {
    const server = await localServer(() => undefined)
    await expect(
      requestJson({
        fetch,
        url: `http://127.0.0.1:${String(server.port)}/`,
        method: 'GET',
        headers: {},
        timeoutMs: 50,
        maxBytes: 1024,
        label: 'Test server',
        local: true
      })
    ).rejects.toThrow('Test server took too long to answer.')
  })

  it('cleans and bounds model output', () => {
    const lyrics = cleanOutput(
      'lyrics-assistance',
      '<think>plan</think>```\n[verse]\r\nline one\u0000‮\n\n\n\n[chorus]\tla\n```'
    )
    expect(lyrics).toEqual({ text: '[verse]\nline one\n\n[chorus] la', truncated: false })
    const ideaText = cleanOutput('song-ideas', '"dark, \n synthwave, 90 bpm"')
    expect(ideaText.text).toBe('dark, synthwave, 90 bpm')
    const long = cleanOutput('lyrics-assistance', `[verse]\n${'word '.repeat(2000)}`)
    expect(long.truncated).toBe(true)
    expect(long.text.length).toBeLessThanOrEqual(4000)
  })

  it('validates and cleans the renderer brief', () => {
    expect(() =>
      assistRequest({
        task: 'lyrics-assistance',
        provider: 'local',
        model: 'm',
        brief: { topic: 'x', structure: 'epic' }
      })
    ).toThrow('invalid lyrics structure')
    expect(() => assistRequest({ ...idea('local', 'm'), provider: 'remote' })).toThrow(
      'invalid text provider'
    )
    const cleaned = assistRequest({
      task: 'lyrics-assistance',
      provider: 'local',
      model: 'm',
      brief: { topic: 'ro\u0000ads\n at night', mood: 'x'.repeat(200), structure: 'short' }
    })
    expect(cleaned.brief).toMatchObject({ topic: 'roads at night', mood: 'x'.repeat(80) })
  })
})

describe('text generation', () => {
  it('sends OpenRouter requests with fallback off and never leaks the key', async () => {
    const cloud = await readyCloud()
    const seen: { url: string; init: RequestInit }[] = []
    const assist = createTextAssist({
      cloud,
      local: createLocalModelHost({ store: localStore() }),
      fetch: async (url, init) => {
        seen.push({ url: url as string, init: init ?? {} })
        return new Response(JSON.stringify(reply('dark synthwave, 90 bpm, female vocals')))
      }
    })
    const outcome = await assist.generate(idea('openrouter', 'example/writer'))
    expect(outcome).toMatchObject({ status: 'done', text: 'dark synthwave, 90 bpm, female vocals' })
    const sent = seen[0]
    expect(sent?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(sent?.init.redirect).toBe('error')
    const body = JSON.parse(sent?.init.body as string) as Record<string, unknown>
    expect(body.provider).toEqual({ allow_fallbacks: false, data_collection: 'deny' })
    expect(body).not.toHaveProperty('models')
    expect(body).not.toHaveProperty('route')
    expect(body.stream).toBe(false)
    expect(JSON.stringify(await assist.options('song-ideas'))).not.toContain(SECRET)

    const failing = createTextAssist({
      cloud,
      local: createLocalModelHost({ store: localStore() }),
      fetch: async () => new Response(`upstream echoed Bearer ${SECRET}`, { status: 500 })
    })
    const error = await failing.generate(idea('openrouter', 'example/writer')).then(
      () => new Error('resolved'),
      (e: unknown) => e as Error
    )
    expect(error.message).toContain('OpenRouter is unavailable right now')
    expect(error.message).not.toContain(SECRET)
    const throwing = createTextAssist({
      cloud,
      local: createLocalModelHost({ store: localStore() }),
      fetch: async () => {
        throw new Error(`socket closed for https://openrouter.ai?key=${SECRET}`)
      }
    })
    const thrown = await throwing.generate(idea('openrouter', 'example/writer')).then(
      () => new Error('resolved'),
      (e: unknown) => e as Error
    )
    expect(thrown.message).not.toContain(SECRET)
    expect(thrown.message).not.toContain('openrouter.ai')
  })

  it('refuses a model outside the registry', async () => {
    const assist = createTextAssist({
      cloud: await readyCloud(),
      local: createLocalModelHost({ store: localStore() }),
      fetch: async () => new Response(JSON.stringify(reply('x')))
    })
    await expect(assist.generate(idea('openrouter', 'other/model'))).rejects.toThrow(
      'OpenRouter registry'
    )
  })

  it('runs one request per task, refuses a duplicate, and cancels', async () => {
    const server = await localServer((req, res) => {
      if (req.url === '/v1/models') json(res, { data: [{ id: 'slow-model' }] })
      // Chat completions never answer: the request stays in flight.
    })
    const local = await readyLocal(server.port)
    await local.test()
    const assist = createTextAssist({ cloud: await readyCloud(), local })
    const first = assist.generate(idea('local', 'slow-model'))
    await expect.poll(() => server.paths.includes('/v1/chat/completions')).toBe(true)
    expect((await assist.options('song-ideas')).running).toBe(true)
    await expect(assist.generate(idea('local', 'slow-model'))).rejects.toThrow('already writing')
    assist.cancel('song-ideas')
    await expect(first).resolves.toEqual({ status: 'cancelled' })
    expect((await assist.options('song-ideas')).running).toBe(false)
  })

  it('writes lyrics with a local model and remembers the model', async () => {
    let body: Record<string, unknown> = {}
    const server = await localServer((req, res) => {
      if (req.url === '/v1/models') {
        json(res, { data: [{ id: 'writer' }] })
        return
      }
      let raw = ''
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()))
      req.on('end', () => {
        body = JSON.parse(raw) as Record<string, unknown>
        json(res, reply('[verse]\nheadlights on the rain\n[chorus]\nwe drive'))
      })
    })
    const local = await readyLocal(server.port)
    await local.test()
    const assist = createTextAssist({ cloud: await readyCloud(), local })
    const outcome = await assist.generate({
      task: 'lyrics-assistance',
      provider: 'local',
      model: 'writer',
      brief: { topic: 'night drive', mood: '', language: 'English', structure: 'short' }
    })
    expect(outcome.status === 'done' && outcome.text).toContain('[chorus]')
    expect(body).not.toHaveProperty('provider')
    expect(JSON.stringify(body.messages)).toContain('[verse]')
    expect((await local.option()).defaultModel).toBe('writer')
  })
})

describe('dialog helpers', () => {
  it('never drops existing text unless Replace is chosen', async () => {
    const { merged, priceLabel } = await import('../src/lib/assist/assist-text')
    expect(merged('song-ideas', '', 'dark synth', 'append')).toBe('dark synth')
    expect(merged('song-ideas', 'lofi', 'dark synth', 'append')).toBe('lofi, dark synth')
    expect(merged('lyrics-assistance', '[verse]\na', '[chorus]\nb', 'append')).toBe(
      '[verse]\na\n\n[chorus]\nb'
    )
    expect(merged('lyrics-assistance', 'old', 'new', 'replace')).toBe('new')
    const model = { id: 'm', name: 'M', inputPerMillion: 1, outputPerMillion: 2, free: false }
    const usd = estimateUsd(model, idea('openrouter', 'm'))
    expect(usd).toBeGreaterThan(0)
    expect(usd).toBeLessThan(0.001)
    expect(priceLabel(model, usd)).toMatch(/^Estimated (up to \$0\.\d{4}|under \$0\.0001)/)
    expect(priceLabel({ ...model, free: true }, 0)).toContain('Free model')
  })
})
