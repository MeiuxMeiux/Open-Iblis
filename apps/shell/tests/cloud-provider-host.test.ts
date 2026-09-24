// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { ipcMain } from 'electron'
import { createCloudProviderHost } from '../electron/main/cloud-providers'
import { registerCloudProviderIpc } from '../electron/main/ipc-cloud-providers'
import {
  emptySettings,
  parseKeys,
  parseModelCache,
  parseSettings,
  type CloudStore,
  type CloudSettingsDocument,
  type ModelCacheEntry
} from '../electron/main/cloud-providers/store'
import type { CloudProviderId } from '../shared/cloud-providers'

function memoryStore(): CloudStore & {
  settings: CloudSettingsDocument
  keys: Partial<Record<CloudProviderId, string>>
} {
  const caches = new Map<CloudProviderId, ModelCacheEntry>()
  return {
    settings: emptySettings(),
    keys: {},
    async loadSettings() {
      return this.settings
    },
    async saveSettings(value) {
      this.settings = JSON.parse(JSON.stringify(value)) as CloudSettingsDocument
    },
    async loadCache(provider) {
      return caches.get(provider) ?? null
    },
    async saveCache(provider, value) {
      caches.set(provider, value)
    },
    async loadKeys() {
      return this.keys
    },
    async saveKeys(value) {
      this.keys = { ...value }
    }
  }
}

const secure = {
  available: () => true,
  seal: (key: string) => `enc:${Buffer.from(key).toString('base64')}`,
  unseal: (value: string) =>
    value.startsWith('enc:') ? Buffer.from(value.slice(4), 'base64').toString() : null
}

describe('Cloud Provider Host', () => {
  it('rejects malformed renderer arguments before they can reach the host', async () => {
    registerCloudProviderIpc()
    const handlers = (
      ipcMain as unknown as {
        handlers: Map<string, (...args: unknown[]) => unknown>
      }
    ).handlers
    const saveKey = handlers.get('cloud-providers:save-key')
    const setEnabled = handlers.get('cloud-providers:set-enabled')
    const setTask = handlers.get('cloud-providers:set-task')
    expect(saveKey).toBeDefined()
    expect(setEnabled).toBeDefined()
    expect(setTask).toBeDefined()
    await expect(saveKey?.({}, 'untrusted-provider', 'secret')).resolves.toEqual({
      ok: false,
      error: 'invalid cloud provider'
    })
    await expect(setEnabled?.({}, 'openrouter', 'yes')).resolves.toEqual({
      ok: false,
      error: 'invalid enabled value'
    })
    await expect(setTask?.({}, 'openrouter', 'untrusted-task', true)).resolves.toEqual({
      ok: false,
      error: 'invalid cloud task'
    })
  })

  it('makes no third-party request until a keyed provider is explicitly enabled and tested', async () => {
    const store = memoryStore()
    let calls = 0
    const host = createCloudProviderHost({
      store,
      secure,
      installed: () => new Set<CloudProviderId>(['openrouter', 'imagerouter']),
      fetch: async () => {
        calls++
        return new Response('{}')
      }
    })
    const initial = await host.snapshot()
    expect(initial.providers[0]?.status).toBe('disabled')
    expect(calls).toBe(0)
    await host.saveKey('openrouter', 'secret-not-in-state')
    expect(JSON.stringify(await host.snapshot())).not.toContain('secret-not-in-state')
    await host.setEnabled('openrouter', true)
    expect(calls).toBe(0)
  })

  it('normalizes and bounds model metadata, preserves defaults, and refuses redirects', async () => {
    const store = memoryStore()
    let init: RequestInit | undefined
    let calls = 0
    const host = createCloudProviderHost({
      store,
      secure,
      installed: () => new Set<CloudProviderId>(['openrouter']),
      fetch: async (_url, request) => {
        init = request
        calls++
        if (calls > 1) return new Response(null, { status: 304 })
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'example/text',
                name: 'Example',
                context_length: 4096,
                architecture: { input_modalities: ['text'], output_modalities: ['text'] },
                pricing: { prompt: '0.000001', completion: '0.000002' },
                supported_parameters: ['temperature'],
                top_provider: { max_completion_tokens: 500 }
              },
              { id: 'ignored/image', architecture: { output_modalities: ['image'] } }
            ]
          }),
          { headers: { ETag: 'abc' } }
        )
      }
    })
    await host.saveKey('openrouter', 'secret')
    await host.setEnabled('openrouter', true)
    await host.test('openrouter')
    const selected = await host.setDefault('song-ideas', 'example/text')
    expect(selected.models).toEqual([
      expect.objectContaining({ id: 'example/text', maxOutput: 500 })
    ])
    expect(selected.defaults['song-ideas']).toBe('example/text')
    expect(init?.redirect).toBe('error')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret')
    await host.refreshModels('openrouter')
    expect((await host.snapshot()).defaults['song-ideas']).toBe('example/text')
    expect((init?.headers as Record<string, string>)['If-None-Match']).toBe('abc')
  })

  it('does not permit a plaintext fallback or capability activation before consent', async () => {
    const store = memoryStore()
    const host = createCloudProviderHost({
      store,
      secure: { available: () => false, seal: () => null, unseal: () => null },
      installed: () => new Set<CloudProviderId>(['imagerouter'])
    })
    await expect(host.saveKey('imagerouter', 'secret')).rejects.toThrow('secure key storage')
    expect(store.keys.imagerouter).toBeUndefined()
    const consentHost = createCloudProviderHost({
      store: memoryStore(),
      secure,
      installed: () => new Set<CloudProviderId>(['openrouter'])
    })
    await expect(consentHost.setTask('openrouter', 'song-ideas', true)).rejects.toThrow(
      'privacy disclosure'
    )
    await consentHost.acknowledgeConsent('openrouter')
    expect(
      (await consentHost.setTask('openrouter', 'song-ideas', true)).providers[0]?.tasks[
        'song-ideas'
      ]
    ).toBe(true)
  })

  it('rejects malformed persisted state and cross-provider capability routes', async () => {
    expect(
      parseSettings({
        version: 1,
        providers: { openrouter: { enabled: 'yes', tasks: { 'song-ideas': true } } },
        defaults: { 'song-ideas': 'x'.repeat(181) }
      })
    ).toEqual(emptySettings())
    expect(parseKeys({ openrouter: 'plaintext', imagerouter: 'enc:sealed' })).toEqual({
      imagerouter: 'enc:sealed'
    })
    expect(
      parseModelCache('openrouter', {
        updatedAt: Date.now(),
        models: [{ id: 'bad', architecture: { output_modalities: ['image'] } }]
      })
    ).toBeNull()
    expect(
      parseModelCache('openrouter', {
        updatedAt: Date.now(),
        models: [
          {
            schemaVersion: 1,
            provider: 'openrouter',
            id: 'cached/text',
            name: 'Cached text',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportedParameters: [],
            sizes: [],
            privacyLabel: 'untrusted value'
          }
        ]
      })
    ).toEqual(
      expect.objectContaining({
        models: [
          expect.objectContaining({
            id: 'cached/text',
            privacyLabel: 'No provider fallback by default; routing choice shown before use'
          })
        ]
      })
    )

    const host = createCloudProviderHost({
      store: memoryStore(),
      secure,
      installed: () => new Set<CloudProviderId>(['openrouter', 'imagerouter'])
    })
    await expect(host.setTask('imagerouter', 'song-ideas', true)).rejects.toThrow(
      'does not provide this capability'
    )
  })
})
