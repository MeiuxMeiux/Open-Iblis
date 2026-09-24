// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Official vs source build endpoints (electron/main/official-endpoints.ts):
// source builds get no update feed and no hosted services unless configured.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildKind,
  catalogBase,
  isOfficialBuild,
  NOT_CONFIGURED,
  NotConfiguredError,
  OFFICIAL_SITE_ORIGIN,
  OFFICIAL_UPDATE_FEED,
  requireServiceEndpoint,
  serviceEndpoint,
  siteOrigin,
  trainingsIndexBase,
  updateFeedUrl,
  type ServiceEndpoint
} from '../electron/main/official-endpoints'
import { autoUpdateEnabled } from '../electron/main/updater'
import { trainingsConfigured, trainingsRequest } from '../electron/main/training/remote'
import { loadLabCatalog } from '../electron/main/catalog/lab-client'

const SERVICES: ServiceEndpoint[] = ['keys', 'trainings', 'diag', 'labs']
const OVERRIDES = [
  'IBLIS_KEYS_BASE',
  'IBLIS_TRAININGS_BASE',
  'IBLIS_DIAG_ENDPOINT',
  'IBLIS_LAB_CATALOG_BASE',
  'IBLIS_CATALOG_BASE',
  'IBLIS_TRAININGS_INDEX_BASE'
]

function build(kind: 'official' | 'source'): void {
  vi.stubEnv('IBLIS_OFFICIAL_BUILD', kind === 'official' ? 'true' : 'false')
  for (const name of OVERRIDES) vi.stubEnv(name, '')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('official build', () => {
  it('uses the official services and update feed', () => {
    build('official')
    expect(isOfficialBuild()).toBe(true)
    expect(buildKind()).toBe('official')
    expect(serviceEndpoint('keys')).toBe(`${OFFICIAL_SITE_ORIGIN}/api/v1/keys`)
    expect(serviceEndpoint('trainings')).toBe(`${OFFICIAL_SITE_ORIGIN}/api/v1/trainings`)
    expect(serviceEndpoint('diag')).toBe(`${OFFICIAL_SITE_ORIGIN}/api/v1/diag.php`)
    expect(serviceEndpoint('labs')).toBe(`${OFFICIAL_SITE_ORIGIN}/api/labs`)
    expect(updateFeedUrl()).toBe(OFFICIAL_UPDATE_FEED)
    expect(autoUpdateEnabled(true, updateFeedUrl())).toBe(true)
  })

  it('keeps the update feed in step with electron-builder.yml', () => {
    const yml = readFileSync(resolve(__dirname, '../electron-builder.yml'), 'utf8')
    const match = /provider:\s*generic\s*\n\s*url:\s*(\S+)/.exec(yml)
    expect(match?.[1]).toBe(OFFICIAL_UPDATE_FEED)
  })

  it('lets environment overrides win', () => {
    build('official')
    vi.stubEnv('IBLIS_KEYS_BASE', 'http://127.0.0.1:9/keys')
    expect(serviceEndpoint('keys')).toBe('http://127.0.0.1:9/keys')
  })
})

describe('source build', () => {
  it('has no update feed, so auto-update never starts', () => {
    build('source')
    expect(buildKind()).toBe('source')
    expect(updateFeedUrl()).toBe('')
    expect(autoUpdateEnabled(true, updateFeedUrl())).toBe(false)
    expect(autoUpdateEnabled(false, OFFICIAL_UPDATE_FEED)).toBe(false)
  })

  it('has no hosted-service endpoints unless the builder configures them', () => {
    build('source')
    for (const service of SERVICES) {
      expect(serviceEndpoint(service)).toBeNull()
      expect(() => requireServiceEndpoint(service)).toThrow(NotConfiguredError)
    }
    try {
      requireServiceEndpoint('diag')
    } catch (error) {
      expect((error as NotConfiguredError).code).toBe(NOT_CONFIGURED)
    }
    vi.stubEnv('IBLIS_DIAG_ENDPOINT', 'http://127.0.0.1:9/diag')
    expect(serviceEndpoint('diag')).toBe('http://127.0.0.1:9/diag')
  })

  it('still reads the public signed feeds and opens the official site', () => {
    build('source')
    expect(catalogBase('v2')).toBe(`${OFFICIAL_SITE_ORIGIN}/api/v2`)
    expect(trainingsIndexBase()).toBe('https://storage.googleapis.com/iblis-dist/trainings')
    expect(siteOrigin()).toBe(OFFICIAL_SITE_ORIGIN)
  })

  it('refuses community uploads before any network call', async () => {
    build('source')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(trainingsConfigured()).toBe(false)
    await expect(trainingsRequest('reserve.php')).rejects.toBeInstanceOf(NotConfiguredError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses the lab catalog before any network call', async () => {
    build('source')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await loadLabCatalog({ enabled: true, lease: 'lab-lease', pubKeyPem: 'key' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not available in this build/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
