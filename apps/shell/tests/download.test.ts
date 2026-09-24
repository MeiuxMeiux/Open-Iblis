// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PluginAsset } from '@iblis/plugin-sdk'
import { downloadAsset, DownloadCancelled } from '../electron/main/plugins/download'

// Drives downloadAsset against a localhost server whose handler each test sets,
// so we can simulate a clean stream, a mid-body drop + Range resume, a server
// that ignores Range, a stalled connection, and hash/size violations — proving
// the streaming path never buffers whole and keeps the SHA-256 trust gate.

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

let server: Server
let handler: (req: IncomingMessage, res: ServerResponse) => void
let baseUrl = ''
let root = ''

function asset(body: Buffer, over: Partial<PluginAsset> = {}): PluginAsset {
  return {
    path: 'pack.bin',
    sha256: sha256(body),
    bytes: body.length,
    sources: [{ kind: 'gcs', url: `${baseUrl}/pack.bin` }],
    ...over
  }
}

beforeEach(async () => {
  handler = (_req, res) => res.end()
  server = createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  root = mkdtempSync(join(tmpdir(), 'iblis-dl-'))
})

afterEach(async () => {
  rmSync(root, { recursive: true, force: true })
  server.closeAllConnections() // drop lingering keep-alive sockets so close() is prompt
  await new Promise<void>((r) => server.close(() => r()))
})

describe('downloadAsset (streaming)', () => {
  it('streams a multi-chunk asset to disk and verifies its hash', async () => {
    const body = randomBytes(5 * 1024 * 1024) // 5 MB; undici delivers it as many chunks
    handler = (_req, res) => res.end(body)
    const dest = join(root, 'pack.bin')
    await downloadAsset(asset(body), dest)

    expect(readFileSync(dest).equals(body)).toBe(true)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('reports per-chunk progress up to the declared total', async () => {
    const body = randomBytes(256 * 1024)
    handler = (_req, res) => res.end(body)
    const seen: number[] = []
    await downloadAsset(asset(body), join(root, 'pack.bin'), {
      onProgress: (p) => seen.push(p.received)
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBe(body.length)
    expect(seen.every((n) => n <= body.length)).toBe(true)
  })

  it('resumes from a mid-body drop with a Range request (206)', async () => {
    const body = randomBytes(512 * 1024)
    const cut = 200 * 1024
    const ranges: number[] = []
    handler = (req, res) => {
      const range = req.headers.range
      if (!range) {
        // first attempt: flush a prefix and let the client actually consume +
        // write it (so `received` advances to `cut`), THEN drop the socket — the
        // delay is what makes this a resume-from-`cut` rather than a restart
        res.write(body.subarray(0, cut))
        setTimeout(() => res.socket?.destroy(), 300)
        return
      }
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
      ranges.push(start)
      res.statusCode = 206
      res.setHeader('Content-Range', `bytes ${start}-${body.length - 1}/${body.length}`)
      res.end(body.subarray(start))
    }
    const dest = join(root, 'pack.bin')
    await downloadAsset(asset(body), dest, { maxAttempts: 4, idleTimeoutMs: 1000 })

    expect(ranges.length).toBeGreaterThanOrEqual(1) // proved it resumed via Range
    expect(ranges[0]).toBe(cut) // resumed at the exact byte it dropped, not 0
    expect(readFileSync(dest).equals(body)).toBe(true)
  })

  it('restarts cleanly when the server ignores Range (200 on resume)', async () => {
    const body = randomBytes(300 * 1024)
    let calls = 0
    handler = (_req, res) => {
      calls++
      if (calls === 1) {
        res.write(body.subarray(0, 100 * 1024))
        res.socket?.destroy() // drop mid-body to force a resume attempt
        return
      }
      res.end(body) // ignores Range, sends the whole thing again as 200
    }
    const dest = join(root, 'pack.bin')
    await downloadAsset(asset(body), dest, { maxAttempts: 3 })

    expect(readFileSync(dest).equals(body)).toBe(true) // re-hashed from zero, still correct
  })

  it('rejects an asset whose bytes do not match the declared sha256', async () => {
    const body = Buffer.from('tampered-bytes')
    handler = (_req, res) => res.end(body)
    const dest = join(root, 'pack.bin')
    const bad = asset(body, { sha256: sha256(Buffer.from('the-real-bytes')) })
    await expect(downloadAsset(bad, dest)).rejects.toThrow(/sha256 mismatch/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('rejects a body that overruns the declared byte count', async () => {
    const real = randomBytes(64 * 1024)
    handler = (_req, res) => res.end(real)
    const dest = join(root, 'pack.bin')
    // declare fewer bytes than the server sends
    const lying = asset(real, { bytes: 1024 })
    await expect(downloadAsset(lying, dest)).rejects.toThrow(/oversized/)
    expect(existsSync(dest)).toBe(false)
  })

  it('falls through to the next source when the first 404s', async () => {
    const body = randomBytes(32 * 1024)
    handler = (req, res) => {
      if (req.url === '/bad') {
        res.statusCode = 404
        res.end('nope')
        return
      }
      res.end(body)
    }
    const dest = join(root, 'pack.bin')
    const a = asset(body, {
      sources: [
        { kind: 'vendor', url: `${baseUrl}/bad` },
        { kind: 'gcs', url: `${baseUrl}/good` }
      ]
    })
    await downloadAsset(a, dest)
    expect(readFileSync(dest).equals(body)).toBe(true)
  })

  it('stops immediately when the caller aborts (no retry, no leftover part)', async () => {
    const body = randomBytes(512 * 1024)
    const cut = 200 * 1024
    const ctrl = new AbortController()
    let calls = 0
    handler = (_req, res) => {
      calls++
      // Deliver a prefix, then abort the install while it streams.
      res.write(body.subarray(0, cut))
      setTimeout(() => ctrl.abort(), 100)
    }
    const dest = join(root, 'pack.bin')
    await expect(
      downloadAsset(asset(body), dest, { signal: ctrl.signal, maxAttempts: 4, idleTimeoutMs: 5000 })
    ).rejects.toBeInstanceOf(DownloadCancelled)

    expect(calls).toBe(1) // did NOT retry or try another source after the cancel
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('rejects up front if the signal is already aborted', async () => {
    const body = randomBytes(1024)
    handler = (_req, res) => res.end(body)
    const dest = join(root, 'pack.bin')
    await expect(
      downloadAsset(asset(body), dest, { signal: AbortSignal.abort() })
    ).rejects.toBeInstanceOf(DownloadCancelled)
  })

  it('aborts a stalled source via the idle timeout and then fails', async () => {
    handler = (_req, res) => {
      res.write(Buffer.from('partial')) // send a little, then hang forever
      // never end — the idle timer must fire
    }
    const dest = join(root, 'pack.bin')
    const body = randomBytes(8 * 1024)
    await expect(
      downloadAsset(asset(body), dest, { idleTimeoutMs: 150, maxAttempts: 2 })
    ).rejects.toThrow(/all sources failed/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })
})
