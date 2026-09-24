// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { respondWithLocalFile } from '../electron/main/media/file'
import { parseByteRange, planMediaResponse } from '../electron/main/media/range'

let dir: string
let file: string
const bytes = Buffer.from(Array.from({ length: 16 }, (_, index) => index))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'iblis-media-'))
  file = join(dir, 'audio.wav')
  await writeFile(file, bytes)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function request(range?: string, method = 'GET'): Request {
  return new Request('iblis-track://fixture', {
    method,
    ...(range ? { headers: { Range: range } } : {})
  })
}

async function body(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer())
}

describe('byte range planning', () => {
  it('parses closed, open-ended, suffix, and clamped ranges', () => {
    expect(parseByteRange('bytes=2-5', 10)).toEqual({ kind: 'partial', start: 2, end: 5 })
    expect(parseByteRange('bytes=2-', 10)).toEqual({ kind: 'partial', start: 2, end: 9 })
    expect(parseByteRange('bytes=-3', 10)).toEqual({ kind: 'partial', start: 7, end: 9 })
    expect(parseByteRange('bytes=0-999', 10)).toEqual({ kind: 'partial', start: 0, end: 9 })
    expect(parseByteRange('BYTES=-999', 10)).toEqual({ kind: 'partial', start: 0, end: 9 })
  })

  it('rejects unsatisfiable ranges without losing precision on giant digits', () => {
    for (const value of ['bytes=10-', 'bytes=8-7', 'bytes=-0', 'bytes=', 'bytes=x-y']) {
      expect(parseByteRange(value, 10), value).toEqual({ kind: 'unsatisfiable' })
    }
    expect(parseByteRange(`bytes=${'9'.repeat(200)}-`, 10)).toEqual({ kind: 'unsatisfiable' })
  })

  it('ignores unknown units and unsupported multi-ranges', () => {
    expect(parseByteRange('items=1-2', 10)).toEqual({ kind: 'full' })
    expect(parseByteRange('bytes=0-1,4-5', 10)).toEqual({ kind: 'full' })
  })

  it('plans exact headers for 200, 206, 416, HEAD, and 405', () => {
    const full = planMediaResponse({ method: 'GET', range: null, size: 10, mime: 'audio/wav' })
    expect(full).toEqual({
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': 'audio/wav',
        'Content-Length': '10'
      },
      read: { start: 0, end: 9 }
    })
    expect(
      planMediaResponse({ method: 'GET', range: 'bytes=2-5', size: 10, mime: 'audio/wav' })
    ).toMatchObject({
      status: 206,
      headers: { 'Content-Length': '4', 'Content-Range': 'bytes 2-5/10' },
      read: { start: 2, end: 5 }
    })
    expect(
      planMediaResponse({ method: 'GET', range: 'bytes=10-', size: 10, mime: 'audio/wav' })
    ).toMatchObject({
      status: 416,
      headers: { 'Content-Length': '0', 'Content-Range': 'bytes */10' }
    })
    expect(
      planMediaResponse({ method: 'HEAD', range: 'bytes=2-5', size: 10, mime: 'audio/wav' })
    ).toMatchObject({ status: 200, headers: { 'Content-Length': '10' } })
    expect(planMediaResponse({ method: 'POST', range: null, size: 10, mime: 'audio/wav' })).toEqual(
      { status: 405, headers: { Allow: 'GET, HEAD', 'Content-Length': '0' } }
    )
  })
})

describe('bounded local media responses', () => {
  it('streams full and exact partial bytes with authoritative headers', async () => {
    const full = await respondWithLocalFile(request(), file)
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('content-type')).toBe('audio/wav')
    expect(full.headers.get('content-length')).toBe('16')
    expect(full.headers.has('content-range')).toBe(false)
    expect(await body(full)).toEqual(bytes)

    const partial = await respondWithLocalFile(request('bytes=4-7'), file)
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 4-7/16')
    expect(partial.headers.get('content-length')).toBe('4')
    expect(await body(partial)).toEqual(bytes.subarray(4, 8))
  })

  it('serves open and suffix ranges and clamps oversized selections', async () => {
    expect(await body(await respondWithLocalFile(request('bytes=12-'), file))).toEqual(
      bytes.subarray(12)
    )
    expect(await body(await respondWithLocalFile(request('bytes=-3'), file))).toEqual(
      bytes.subarray(13)
    )
    expect(await body(await respondWithLocalFile(request('bytes=-999'), file))).toEqual(bytes)
  })

  it('returns bodyless HEAD, 416, 405, and 404 responses', async () => {
    const head = await respondWithLocalFile(request('bytes=2-5', 'HEAD'), file)
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('16')
    expect((await body(head)).length).toBe(0)

    const unsatisfied = await respondWithLocalFile(request('bytes=99-'), file)
    expect(unsatisfied.status).toBe(416)
    expect(unsatisfied.headers.get('content-range')).toBe('bytes */16')
    expect((await body(unsatisfied)).length).toBe(0)

    const method = await respondWithLocalFile(request(undefined, 'POST'), file)
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('GET, HEAD')
    expect((await body(method)).length).toBe(0)

    const missing = await respondWithLocalFile(request(), join(dir, 'missing.wav'))
    expect(missing.status).toBe(404)
    expect((await body(missing)).length).toBe(0)
  })
})
