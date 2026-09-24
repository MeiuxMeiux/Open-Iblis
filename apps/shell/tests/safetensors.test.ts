// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { safetensorsProblem } from '../electron/main/adapters/safetensors'

const dirs: string[] = []

async function fixture(bytes: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'iblis-st-'))
  dirs.push(dir)
  const path = join(dir, 'f.safetensors')
  await writeFile(path, bytes)
  return path
}

// Build a safetensors container from a header object plus trailing data bytes.
function build(header: unknown, dataBytes = 4): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(json.length))
  return Buffer.concat([len, json, Buffer.alloc(dataBytes)])
}

const validHeader = { t: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } }

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('safetensorsProblem', () => {
  it('accepts a well-formed single-tensor file', async () => {
    expect(await safetensorsProblem(await fixture(build(validHeader)))).toBeNull()
  })

  it('accepts string-only __metadata__ alongside a tensor', async () => {
    const header = {
      __metadata__: { format: 'pt' },
      t: { dtype: 'F32', shape: [1], data_offsets: [0, 4] }
    }
    expect(await safetensorsProblem(await fixture(build(header)))).toBeNull()
  })

  it('rejects a pickle container (\\x80 lead)', async () => {
    // Protocol 4: PROTO 4, FRAME opcode, 8-byte frame length, then opcodes.
    const pickle = Buffer.concat([Buffer.from('80049563000000000000007d', 'hex'), Buffer.alloc(20)])
    expect(await safetensorsProblem(await fixture(pickle))).toMatch(/pickle\/zip/)
  })

  it('rejects a zip container (PK lead)', async () => {
    const zip = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(20)])
    expect(await safetensorsProblem(await fixture(zip))).toMatch(/pickle\/zip/)
  })

  it('rejects a too-small file', async () => {
    expect(await safetensorsProblem(await fixture(Buffer.alloc(4)))).toMatch(/too small/)
  })

  it('rejects a header length larger than 1 MiB', async () => {
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(1_048_577n)
    expect(await safetensorsProblem(await fixture(Buffer.concat([len, Buffer.alloc(32)])))).toMatch(
      /out of bounds/
    )
  })

  it('rejects a header that overruns the file', async () => {
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(4096n) // claims 4 KiB header but file is tiny
    expect(await safetensorsProblem(await fixture(Buffer.concat([len, Buffer.alloc(16)])))).toMatch(
      /exceeds the file/
    )
  })

  it('rejects an unsupported dtype', async () => {
    const header = { t: { dtype: 'COMPLEX128', shape: [1], data_offsets: [0, 4] } }
    expect(await safetensorsProblem(await fixture(build(header)))).toMatch(/unsupported dtype/)
  })

  it('rejects data_offsets that run past the tensor data', async () => {
    const header = { t: { dtype: 'F32', shape: [1], data_offsets: [0, 8] } }
    expect(await safetensorsProblem(await fixture(build(header, 4)))).toMatch(/outside the file/)
  })

  it('rejects an entry with extra keys', async () => {
    const header = { t: { dtype: 'F32', shape: [1], data_offsets: [0, 4], extra: 1 } }
    expect(await safetensorsProblem(await fixture(build(header)))).toMatch(/exactly dtype\/shape/)
  })

  it('rejects a header describing no tensors', async () => {
    expect(await safetensorsProblem(await fixture(build({ __metadata__: { a: 'b' } })))).toMatch(
      /no tensors/
    )
  })

  it('rejects non-string __metadata__ values', async () => {
    const header = { __metadata__: { n: 5 }, t: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } }
    expect(await safetensorsProblem(await fixture(build(header)))).toMatch(/__metadata__ values/)
  })

  // Audit 2026-09-24 M-TRN2: the range must hold exactly dtype * prod(shape).
  it('rejects a shape that claims more bytes than its range', async () => {
    const header = { t: { dtype: 'F32', shape: [1099511627776, 1048576], data_offsets: [0, 4] } }
    expect(await safetensorsProblem(await fixture(build(header)))).toMatch(/does not match/)
  })

  it('accepts adjacent tensors and rejects overlapping ones', async () => {
    const adjacent = {
      a: { dtype: 'U8', shape: [4], data_offsets: [0, 4] },
      b: { dtype: 'U8', shape: [4], data_offsets: [4, 8] }
    }
    expect(await safetensorsProblem(await fixture(build(adjacent, 8)))).toBeNull()
    const overlap = {
      a: { dtype: 'U8', shape: [6], data_offsets: [0, 6] },
      b: { dtype: 'U8', shape: [4], data_offsets: [4, 8] }
    }
    expect(await safetensorsProblem(await fixture(build(overlap, 8)))).toBe(
      'safetensors tensors overlap'
    )
  })

  it('caps tensor rank', async () => {
    const header = { t: { dtype: 'U8', shape: [1, 1, 1, 1, 1, 1, 1, 1, 1], data_offsets: [0, 1] } }
    expect(await safetensorsProblem(await fixture(build(header)))).toMatch(/malformed shape/)
  })

  // Audit 2026-09-24 M-TRN1: attacker-chosen names never reach a reason raw.
  it('bounds and sanitizes a hostile tensor name in the reason', async () => {
    const name = 'A'.repeat(200_000) + "\u001b[31m'"
    const header = { [name]: { dtype: 'X', shape: [1], data_offsets: [0, 1] } }
    const why = (await safetensorsProblem(await fixture(build(header)))) ?? ''
    expect(why).toMatch(/unsupported dtype/)
    expect(why.length).toBeLessThan(120)
    expect(why).toMatch(/^[\x20-\x7E]+$/)
  })
})
