// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginManifest } from '@iblis/plugin-sdk'
import type { ImportedAdapterRecord } from '../shared/adapters'
import {
  nameForRecord,
  syncGenerationAdapterRoot,
  withGenerationAdapterRoot
} from '../electron/main/adapters/generation-root'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function record(overrides: Partial<ImportedAdapterRecord>): ImportedAdapterRecord {
  return {
    id: 'safetensors-' + 'a'.repeat(64),
    format: 'safetensors',
    sha256: 'a'.repeat(64),
    bytes: 10,
    importedAt: 1,
    displayName: 'My Style!',
    acknowledgedAt: 1,
    files: [{ name: 'adapter.safetensors', sha256: 'a'.repeat(64), bytes: 10 }],
    ...overrides
  }
}

describe('generation adapter root', () => {
  it('mirrors safetensors records under stable slug-hash names and prunes stale ones', async () => {
    const base = await mkdtemp(join(tmpdir(), 'iblis-genroot-'))
    roots.push(base)
    const items = join(base, 'items')
    const root = join(base, 'engine-root')
    const yours = record({})
    await mkdir(join(items, yours.id), { recursive: true })
    await writeFile(join(items, yours.id, 'adapter.safetensors'), 'ten bytes!', 'utf8')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'stale-deadbeef.safetensors'), 'old', 'utf8')

    await syncGenerationAdapterRoot([yours], items, root)
    const names = await readdir(root)
    expect(names).toEqual([`${nameForRecord(yours)}.safetensors`])
    expect(nameForRecord(yours)).toBe('my-style-aaaaaaaa')

    // Second sync is idempotent (EEXIST tolerated).
    await syncGenerationAdapterRoot([yours], items, root)
    expect(await readdir(root)).toHaveLength(1)
  })

  it('leaves PEFT records out of the flat root', async () => {
    const base = await mkdtemp(join(tmpdir(), 'iblis-genroot-'))
    roots.push(base)
    const peft = record({
      format: 'peft',
      files: [
        { name: 'adapter_model.safetensors', sha256: 'b'.repeat(64), bytes: 5 },
        { name: 'adapter_config.json', sha256: 'c'.repeat(64), bytes: 5 }
      ]
    })
    const root = join(base, 'engine-root')
    await syncGenerationAdapterRoot([peft], join(base, 'items'), root)
    expect(await readdir(root)).toEqual([])
  })

  it('appends --adapters to engine manifests only, and never twice', () => {
    const engine = {
      kind: 'engine',
      executable: { bin: 'ace-server.exe', args: ['--models', '.'] }
    } as unknown as PluginManifest
    const once = withGenerationAdapterRoot(engine, '/root')
    expect(once.executable?.args).toEqual(['--models', '.', '--adapters', '/root'])
    expect(withGenerationAdapterRoot(once, '/other').executable?.args).toEqual(
      once.executable?.args
    )
    const skin = { kind: 'skin' } as unknown as PluginManifest
    expect(withGenerationAdapterRoot(skin, '/root')).toBe(skin)
  })
})
