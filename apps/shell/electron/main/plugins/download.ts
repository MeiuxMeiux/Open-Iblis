// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash, type Hash } from 'node:crypto'
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import type { PluginAsset } from '@iblis/plugin-sdk'
import { log } from '../logger'
import { errorMessage } from '../error-message'

// Fetch one asset to disk, trying its sources in declared order (vendor-direct
// first, GCS fallback). The bytes are STREAMED to a `.part` file with a
// chunk-by-chunk SHA-256 and atomic-renamed into place only once the full hash
// verifies — nothing is ever buffered whole in memory, so a multi-GB GGUF
// installs the same as the 3 KB echo stub (Node's ~2 GB Buffer ceiling no
// longer applies). A mid-stream drop resumes with an HTTP Range request; a
// stalled server is aborted by an idle timer; GCS is a host, not a trust root,
// so the hash gate is identical across sources.

const IDLE_TIMEOUT_MS = 30_000 // abort a source if no bytes arrive for this long
const MAX_ATTEMPTS = 4 // Range-resume tries per source before falling through

interface DownloadProgress {
  path: string
  received: number
  total: number // declared asset.bytes, or 0 if the manifest omits it
}

export interface DownloadOptions {
  idleTimeoutMs?: number
  maxAttempts?: number
  onProgress?: (p: DownloadProgress) => void
  // External cancel (user hit "Cancel"). When it fires, the download stops
  // immediately — no retry, no fall-through to the next source.
  signal?: AbortSignal
}

export class DownloadCancelled extends Error {
  constructor(path: string) {
    super(`download cancelled for ${path}`)
    this.name = 'DownloadCancelled'
  }
}

// A source-permanent failure (bad status, size/hash mismatch, oversized body):
// retrying the SAME url cannot help, so we skip straight to the next source.
function permanent(message: string): Error {
  const e = new Error(message)
  ;(e as Error & { permanent?: boolean }).permanent = true
  return e
}

function isPermanent(e: unknown): boolean {
  return Boolean((e as { permanent?: boolean } | null | undefined)?.permanent)
}

export async function downloadAsset(
  asset: PluginAsset,
  dest: string,
  opts: DownloadOptions = {}
): Promise<void> {
  if (opts.signal?.aborted) throw new DownloadCancelled(asset.path)
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  rmSync(part, { force: true })

  let lastError: unknown
  for (const source of asset.sources) {
    try {
      await streamSource(source.url, part, asset, opts)
      renameSync(part, dest) // atomic: a verified asset appears in one step
      return
    } catch (e) {
      lastError = e
      rmSync(part, { force: true }) // never leave a partial behind for the next source
      // A user cancel stops everything — don't log it as a source failure or
      // try the next source.
      if (opts.signal?.aborted) throw new DownloadCancelled(asset.path)
      log('warn', 'asset source failed', {
        path: asset.path,
        kind: source.kind,
        error: errorMessage(e)
      })
    }
  }
  throw new Error(`all sources failed for ${asset.path}: ${errorMessage(lastError)}`)
}

// Resolves once the descriptor is closed, not merely flushed ('finish'):
// Windows refuses to rename a directory while any file inside is still open,
// and the installer renames the staging folder right after the last asset.
function closeFile(file: import('node:fs').WriteStream): Promise<void> {
  if (file.closed) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    file.once('error', reject)
    file.once('close', () => resolve())
    file.end()
  })
}

// Body fully consumed — verify size (when the manifest declares it) then the
// streamed digest. Both are permanent: the same url would serve the same bytes.
function verifyDownload(asset: PluginAsset, received: number, hash: Hash): void {
  const total = asset.bytes || 0
  if (total && received !== total) {
    throw permanent(`size mismatch for ${asset.path}: expected ${total}, got ${received}`)
  }
  const digest = hash.digest('hex')
  if (digest !== asset.sha256) {
    throw permanent(`sha256 mismatch for ${asset.path}: expected ${asset.sha256}, got ${digest}`)
  }
}

// Download a single url to `part`, resuming from a partial on interruption.
// `received` and `hash` persist across attempts so a Range-resume continues the
// same digest over the bytes already on disk.
async function streamSource(
  url: string,
  part: string,
  asset: PluginAsset,
  opts: DownloadOptions
): Promise<void> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS

  // `received` lives in a holder so pumpBody can commit each chunk to it as it
  // lands — if a stream throws mid-body, the bytes already on disk are still
  // counted and the next attempt resumes from there (not from zero).
  const progress = { received: 0 }
  let hash = createHash('sha256')

  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController()
    let idle: ReturnType<typeof setTimeout> | undefined
    const arm = (): void => {
      if (idle) clearTimeout(idle)
      idle = setTimeout(() => ctrl.abort(new Error('idle timeout')), idleTimeoutMs)
    }

    try {
      arm()
      // Abort on EITHER the idle timer or the caller's cancel signal.
      const signal = opts.signal ? AbortSignal.any([ctrl.signal, opts.signal]) : ctrl.signal
      const headers = progress.received > 0 ? { Range: `bytes=${progress.received}-` } : undefined
      // Redirects are FOLLOWED here on purpose: asset sources are vendor-direct
      // (e.g. Hugging Face `resolve/` URLs 302 to their CDN, and some assets
      // have no GCS fallback), and every byte is SHA-256-pinned from the signed
      // catalog — a redirect cannot substitute content, only relocate it. The
      // redirect: 'error' hardening is applied to the signed-metadata/API
      // fetches instead, where our hosts never redirect.
      const res = await fetch(url, { signal, redirect: 'follow', headers })

      // A resume that the server honours comes back 206; anything else that
      // isn't a plain 200 is this source giving up.
      if (!res.ok && res.status !== 206) {
        throw permanent(`${res.status} ${res.statusText} for ${url}`)
      }
      // We asked to resume but got the whole file again (no Range support) —
      // discard the partial and re-hash from byte zero.
      if (progress.received > 0 && res.status !== 206) {
        progress.received = 0
        hash = createHash('sha256')
        rmSync(part, { force: true })
      }

      const file = createWriteStream(part, { flags: progress.received > 0 ? 'a' : 'w' })
      try {
        await pumpBody(res, file, hash, asset, progress, arm, opts.onProgress)
      } finally {
        await closeFile(file)
      }
      verifyDownload(asset, progress.received, hash)
      return
    } catch (e) {
      // A user cancel is terminal — never retry or fall through to another source.
      if (opts.signal?.aborted) throw new DownloadCancelled(asset.path)
      // Permanent (bad status/hash/size) or out of tries → surface to the caller
      // so it moves on to the next source. Otherwise resume from `received`.
      if (isPermanent(e) || attempt >= maxAttempts) throw e
      log('warn', 'asset stream interrupted, resuming', {
        path: asset.path,
        received: progress.received,
        attempt,
        error: errorMessage(e)
      })
      // Brief backoff before reopening: eases off a flaky host and lets a reset
      // connection drain from the fetch pool so the resume opens a fresh socket.
      await new Promise((r) => setTimeout(r, 150 * attempt))
    } finally {
      if (idle) clearTimeout(idle)
    }
  }
}

// Drain a response body to disk, hashing each chunk AFTER it is written and
// committing it to `progress.received` in the same step, so the digest, the
// file, and the counter stay byte-for-byte in lockstep. If the stream throws
// mid-body the partial bytes are already committed, so the caller's next
// attempt resumes from exactly where this one stopped. `arm` re-arms the idle
// timer on every chunk so only a true stall (no bytes) trips the timeout.
async function pumpBody(
  res: Response,
  file: import('node:fs').WriteStream,
  hash: Hash,
  asset: PluginAsset,
  progress: { received: number },
  arm: () => void,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  if (!res.body) throw new Error(`empty response body for ${asset.path}`)
  const total = asset.bytes || 0

  for await (const chunk of Readable.fromWeb(res.body)) {
    arm()
    const buf = chunk as Buffer
    if (total && progress.received + buf.length > total) {
      throw permanent(`oversized stream for ${asset.path}: exceeds declared ${total} bytes`)
    }
    await new Promise<void>((resolve, reject) =>
      file.write(buf, (err) => (err ? reject(err) : resolve()))
    )
    hash.update(buf)
    progress.received += buf.length
    onProgress?.({ path: asset.path, received: progress.received, total })
  }
}
