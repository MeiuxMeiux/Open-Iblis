// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Property tests for main-process parsers that read attacker-shaped input:
// HTTP Range headers from the renderer's media requests and safetensors
// files from imports, the training pull-down, and catalog offers.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { safetensorsProblem } from '../electron/main/adapters/safetensors'
import { parseByteRange, planMediaResponse } from '../electron/main/media/range'

// Default 100 cases per property; IBLIS_FC_RUNS=20000 for a deep local run.
fc.configureGlobal({ numRuns: Number(process.env.IBLIS_FC_RUNS ?? 100) })

const size = fc.nat({ max: 2 ** 40 })
const digits = fc.oneof(
  fc.nat({ max: 2 ** 41 }).map(String),
  fc.constant(''),
  fc.constant('9'.repeat(30))
)
const rangeHeader = fc.oneof(
  fc
    .tuple(fc.constantFrom('bytes', 'BYTES', ' bytes ', 'items', ''), digits, digits)
    .map(([unit, a, b]) => `${unit}=${a}-${b}`),
  fc.string({ maxLength: 40 }),
  fc.constant(null)
)

describe('byte ranges', () => {
  it('never throws, and a partial range lies inside the file', () => {
    fc.assert(
      fc.property(rangeHeader, size, (header, total) => {
        const decision = parseByteRange(header, total)
        if (decision.kind !== 'partial') return true
        return 0 <= decision.start && decision.start <= decision.end && decision.end < total
      })
    )
  })

  it('matches the RFC 9110 model for single closed and suffix ranges', () => {
    fc.assert(
      fc.property(fc.nat({ max: 2 ** 40 }), fc.nat({ max: 2 ** 41 }), size, (a, b, total) => {
        const closed = parseByteRange(`bytes=${a}-${b}`, total)
        if (a >= total || b < a) expect(closed.kind).toBe('unsatisfiable')
        else expect(closed).toEqual({ kind: 'partial', start: a, end: Math.min(b, total - 1) })

        const suffix = parseByteRange(`bytes=-${b}`, total)
        if (b === 0 || total === 0) expect(suffix.kind).toBe('unsatisfiable')
        else
          expect(suffix).toEqual({ kind: 'partial', start: Math.max(0, total - b), end: total - 1 })
      })
    )
  })

  it('plans headers that agree with the bytes it will read', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('GET', 'HEAD', 'get', 'POST'),
        rangeHeader,
        size,
        (method, range, total) => {
          const plan = planMediaResponse({ method, range, size: total, mime: 'audio/wav' })
          const length = Number(plan.headers['Content-Length'])
          if (plan.status === 206) {
            const { start = -1, end = -1 } = plan.read ?? {}
            expect(length).toBe(end - start + 1)
            expect(plan.headers['Content-Range']).toBe(`bytes ${start}-${end}/${total}`)
          }
          if (plan.status === 200) expect(length).toBe(total)
          if (method === 'HEAD') expect(plan.read).toBeUndefined()
          if (plan.status === 405 || plan.status === 416) expect(length).toBe(0)
        }
      )
    )
  })
})

const DTYPE_BYTES: Record<string, number> = {
  F64: 8,
  F32: 4,
  F16: 2,
  BF16: 2,
  I64: 8,
  I32: 4,
  I16: 2,
  I8: 1,
  U8: 1,
  BOOL: 1
}

// A well-formed header: each tensor's range holds exactly dtype * prod(shape)
// bytes, ranges never overlap (optional gaps between them), optional string
// metadata, optional space padding (audit 2026-09-24, M-TRN2).
const validFile = fc
  .record({
    tensors: fc.dictionary(
      fc
        .string({ minLength: 1, maxLength: 12 })
        .filter((k) => k !== '__metadata__' && k !== '__proto__'),
      fc.record({
        dtype: fc.constantFrom(...Object.keys(DTYPE_BYTES)),
        shape: fc.array(fc.nat({ max: 8 }), { maxLength: 4 }),
        gap: fc.nat({ max: 16 })
      }),
      { minKeys: 1, maxKeys: 5 }
    ),
    metadata: fc.option(fc.dictionary(fc.string({ maxLength: 8 }), fc.string({ maxLength: 8 }))),
    padding: fc.nat({ max: 8 })
  })
  .map(({ tensors, metadata, padding }) => {
    const header: Record<string, unknown> = metadata ? { __metadata__: metadata } : {}
    let cursor = 0
    for (const [name, t] of Object.entries(tensors)) {
      const bytes = t.shape.reduce((n, d) => n * d, DTYPE_BYTES[t.dtype] ?? 1)
      const begin = cursor + t.gap
      header[name] = { dtype: t.dtype, shape: t.shape, data_offsets: [begin, begin + bytes] }
      cursor = begin + bytes
    }
    return safetensorsBytes(JSON.stringify(header) + ' '.repeat(padding), cursor)
  })

function safetensorsBytes(header: string, dataBytes: number): Buffer {
  const json = Buffer.from(header)
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(json.length))
  return Buffer.concat([len, json, Buffer.alloc(dataBytes)])
}

describe('safetensors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'iblis-st-prop-'))
  const file = join(dir, 'x.safetensors')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts every well-formed file', async () => {
    await fc.assert(
      fc.asyncProperty(validFile, async (bytes) => {
        writeFileSync(file, bytes)
        expect(await safetensorsProblem(file)).toBeNull()
      })
    )
  })

  it('never throws on arbitrary bytes or corrupted valid files', async () => {
    const corrupted = fc
      .tuple(validFile, fc.nat(), fc.integer({ min: 1, max: 255 }))
      .map(([bytes, at, xor]) => {
        const copy = Buffer.from(bytes)
        const index = at % copy.length
        copy[index] = (copy[index] ?? 0) ^ xor
        return copy
      })
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.uint8Array({ maxLength: 64 }).map((array) => Buffer.from(array)),
          corrupted
        ),
        async (bytes) => {
          writeFileSync(file, bytes)
          const problem = await safetensorsProblem(file)
          expect(problem === null || typeof problem === 'string').toBe(true)
        }
      )
    )
  })

  it('refuses a tensor whose data would run past the file', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 1024 }),
        fc.integer({ min: 1, max: 64 }),
        async (data, over) => {
          const header = JSON.stringify({
            w: { dtype: 'U8', shape: [1], data_offsets: [0, data + over] }
          })
          writeFileSync(file, safetensorsBytes(header, data))
          expect(await safetensorsProblem(file)).toMatch(/outside the file/)
        }
      )
    )
  })
})
