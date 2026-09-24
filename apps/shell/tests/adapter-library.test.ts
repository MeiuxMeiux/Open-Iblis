// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createAdapterLibrary } from '../electron/main/adapters/library'

const roots: string[] = []

// A minimal valid safetensors container (one F32 tensor + 4 data bytes). The
// library now re-validates every imported .safetensors, so fixtures must be
// real safetensors rather than arbitrary bytes.
function validSafetensors(): Buffer {
  const header = Buffer.from('{"t":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}', 'utf8')
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(header.length))
  return Buffer.concat([len, header, Buffer.from([1, 2, 3, 4])])
}

async function root(): Promise<string> {
  const next = await mkdtemp(join(tmpdir(), 'iblis-adapters-'))
  roots.push(next)
  return next
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const disclosure = {
  displayName: 'Test adapter',
  sourceOfferId: 'test-adapter-v1',
  sourceUrl: 'https://example.test/adapter',
  claimedLicense: 'unknown',
  acknowledgedAt: 1
}

describe('user adapter library', () => {
  it('keeps rights limits and missing claims visible in the skin-aware disclosure', () => {
    const disclosure = readFileSync(
      join(__dirname, '../src/lib/styles/StyleDisclosureDialog.svelte'),
      'utf8'
    )
    expect(disclosure).toContain("'Not supplied'")
    expect(disclosure).toContain(
      'does not grant commercial, copyright, publicity, or training-data rights'
    )
    expect(disclosure).toContain('not certified or enabled for generation')
  })

  it('copies and hashes a user-selected Safetensors file without retaining its source path', async () => {
    const folder = await root()
    const source = join(folder, 'source.safetensors')
    const bytes = validSafetensors()
    await writeFile(source, bytes)

    const library = createAdapterLibrary(join(folder, 'library'), () => 100)
    const adapter = await library.import(source, disclosure)

    expect(adapter.format).toBe('safetensors')
    expect(adapter.sourceOfferId).toBe('test-adapter-v1')
    expect(adapter.files).toEqual([
      {
        name: 'adapter.safetensors',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length
      }
    ])
    expect(JSON.stringify(adapter)).not.toContain(source)
    expect(
      await readFile(join(folder, 'library', 'items', adapter.id, 'adapter.safetensors'))
    ).toEqual(bytes)
    expect(await library.list()).toEqual([adapter])
  })

  it('requires the documented PEFT pair, deduplicates it, and removes its private copy', async () => {
    const folder = await root()
    const source = join(folder, 'peft')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(source)
    await writeFile(join(source, 'adapter_model.safetensors'), validSafetensors())
    await writeFile(join(source, 'adapter_config.json'), '{"peft_type":"LORA"}')

    const library = createAdapterLibrary(join(folder, 'library'), () => 200)
    const first = await library.import(source, disclosure)
    const duplicate = await library.import(source, { ...disclosure, displayName: 'Later name' })

    expect(first.format).toBe('peft')
    expect(first.files.map((file) => file.name)).toEqual([
      'adapter_model.safetensors',
      'adapter_config.json'
    ])
    expect(duplicate).toEqual(first)
    expect(await library.remove(first.id)).toBe(true)
    expect(await library.remove(first.id)).toBe(false)
    expect(await library.list()).toEqual([])
  })

  it('rejects missing acknowledgment, unsupported extensions, and links before copying', async () => {
    const folder = await root()
    const source = join(folder, 'source.safetensors')
    await writeFile(source, 'weights')
    const library = createAdapterLibrary(join(folder, 'library'))

    await expect(library.import(source, { ...disclosure, acknowledgedAt: 0 })).rejects.toThrow(
      'warning must be acknowledged'
    )
    await expect(library.import(join(folder, 'wrong.bin'), disclosure)).rejects.toThrow()
    await symlink(source, join(folder, 'linked.safetensors'))
    await expect(library.import(join(folder, 'linked.safetensors'), disclosure)).rejects.toThrow(
      'cannot be a link'
    )
  })

  it('rejects a .safetensors file whose bytes are not valid safetensors', async () => {
    const folder = await root()
    const source = join(folder, 'source.safetensors')
    // A pickle container (.pt) renamed to .safetensors — the extension check
    // passes, but the content gate must refuse it.
    await writeFile(source, Buffer.concat([Buffer.from([0x80, 0x04]), Buffer.alloc(64)]))
    const library = createAdapterLibrary(join(folder, 'library'))

    await expect(library.import(source, disclosure)).rejects.toThrow('not valid safetensors')
    // Nothing is admitted to the library on a rejected import.
    expect(await library.list()).toEqual([])
  })

  it('copies a newly verified managed record into the engine-discoverable proof layout', async () => {
    const folder = await root()
    const source = join(folder, 'source.safetensors')
    const bytes = validSafetensors()
    await writeFile(source, bytes)
    const library = createAdapterLibrary(join(folder, 'library'))
    const adapter = await library.import(source, disclosure)
    const proofRoot = join(folder, 'proof-root')

    await expect(library.copyForCompatibilityProof(adapter.id, proofRoot)).resolves.toEqual(adapter)
    expect(await readFile(join(proofRoot, 'adapter.safetensors'))).toEqual(bytes)

    await rm(join(folder, 'library', 'items', adapter.id, 'adapter.safetensors'))
    await expect(
      library.copyForCompatibilityProof(adapter.id, join(folder, 'second-proof'))
    ).rejects.toThrow()
  })
})
