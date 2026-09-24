// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '@iblis/plugin-sdk'

const mocks = vi.hoisted(() => ({
  acquireProcessorMutation: vi.fn(),
  acquireEngineMutation: vi.fn(),
  loadCatalog: vi.fn(),
  install: vi.fn(),
  rollback: vi.fn(),
  remove: vi.fn(),
  status: vi.fn(),
  listInstalled: vi.fn(),
  readInstalledManifest: vi.fn(),
  hotSwap: vi.fn(),
  stop: vi.fn(),
  listAdapters: vi.fn(),
  syncGenerationAdapterRoot: vi.fn(),
  withGenerationAdapterRoot: vi.fn((manifest: unknown) => manifest)
}))

vi.mock('../electron/main/processors', () => ({
  acquireProcessorMutation: mocks.acquireProcessorMutation
}))
vi.mock('../electron/main/generation-queue', () => ({
  acquireEngineMutation: mocks.acquireEngineMutation
}))
vi.mock('../electron/main/catalog/client', () => ({ loadCatalog: mocks.loadCatalog }))
vi.mock('../electron/main/plugins/registry', () => ({
  install: mocks.install,
  rollback: mocks.rollback,
  remove: mocks.remove,
  status: mocks.status,
  listInstalled: mocks.listInstalled
}))
vi.mock('../electron/main/plugins/installed-manifest', () => ({
  readInstalledManifest: mocks.readInstalledManifest
}))
vi.mock('../electron/main/sidecar/supervisor', () => ({
  hotSwap: mocks.hotSwap,
  stop: mocks.stop
}))
vi.mock('../electron/main/adapters', () => ({ listAdapters: mocks.listAdapters }))
vi.mock('../electron/main/adapters/generation-root', () => ({
  syncGenerationAdapterRoot: mocks.syncGenerationAdapterRoot,
  withGenerationAdapterRoot: mocks.withGenerationAdapterRoot
}))

import {
  installFromCatalog,
  removePlugin,
  rollbackPlugin
} from '../electron/main/plugins/lifecycle'

const processor: PluginManifest = {
  id: 'mx.iblis.processor.test',
  name: 'Test processor',
  version: '1.0.0',
  kind: 'processor',
  hostMinVersion: '0.0.0',
  capabilities: ['bpm-detect'],
  executable: { bin: 'processor.exe', args: [] },
  assets: [],
  license: 'MIT',
  author: { name: 'Meiux Meiux LLC' }
}

describe('processor plugin lifecycle leases', () => {
  let release: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    release = vi.fn(async () => {})
    mocks.acquireProcessorMutation.mockResolvedValue(release)
    mocks.loadCatalog.mockResolvedValue({ ok: true, data: { plugins: [{ manifest: processor }] } })
    mocks.install.mockResolvedValue({
      id: processor.id,
      activeVersion: processor.version,
      versions: [processor.version]
    })
    mocks.rollback.mockReturnValue({
      id: processor.id,
      activeVersion: '0.9.0',
      versions: ['0.9.0', '1.0.0']
    })
    mocks.status.mockReturnValue({ activeVersion: processor.version })
    mocks.readInstalledManifest.mockReturnValue(processor)
    mocks.hotSwap.mockResolvedValue(undefined)
    mocks.stop.mockResolvedValue(undefined)
  })

  it('holds the processor mutation lease across install and sidecar activation', async () => {
    await expect(installFromCatalog(processor.id, processor.version)).resolves.toMatchObject({
      ok: true
    })
    expect(mocks.acquireProcessorMutation).toHaveBeenCalledWith(processor.id)
    expect(mocks.hotSwap).toHaveBeenCalledWith(processor)
    expect(release).toHaveBeenCalledTimes(1)
    expect(mocks.hotSwap.mock.invocationCallOrder[0]!).toBeLessThan(
      release.mock.invocationCallOrder[0]!
    )
  })

  it('holds the processor mutation lease across rollback and relaunch', async () => {
    await expect(rollbackPlugin(processor.id)).resolves.toMatchObject({ ok: true })
    expect(mocks.acquireProcessorMutation).toHaveBeenCalledWith(processor.id)
    expect(mocks.rollback).toHaveBeenCalledWith(processor.id)
    expect(mocks.hotSwap.mock.invocationCallOrder[0]!).toBeLessThan(
      release.mock.invocationCallOrder[0]!
    )
  })

  it('holds the processor mutation lease through stop and removal', async () => {
    await expect(removePlugin(processor.id)).resolves.toMatchObject({ ok: true })
    expect(mocks.acquireProcessorMutation).toHaveBeenCalledWith(processor.id)
    expect(mocks.stop).toHaveBeenCalledWith(processor.id)
    expect(mocks.remove).toHaveBeenCalledWith(processor.id)
    expect(mocks.remove.mock.invocationCallOrder[0]!).toBeLessThan(
      release.mock.invocationCallOrder[0]!
    )
  })
})
