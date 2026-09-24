// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { currentLease } from '../licensing'
import { log, recentEvents, setErrorHook } from '../logger'
import { buildBundle, getInstallId, DIAG_SCHEMA } from './bundle'
import { redactValue, type DiagLevel } from './redact'
import { requireServiceEndpoint } from '../official-endpoints'

// Opt-in diagnostics uploader. Off by default. See docs/feature/diagnostics.md.
// The ingest endpoint is served from this repo's docroot; bundles land in
// the server's diagnostics store, read with `just diag-read <ref>`. The
// endpoint comes from official-endpoints.ts; a source build has none unless
// its builder set IBLIS_DIAG_ENDPOINT, and then nothing is ever sent.

// No shared secret ships in a build: the server admits uploads by per-subject
// rate and volume caps, keyed on the entitlement lease when one exists.
const STREAM_INTERVAL_MS = 30_000

function levelFile(): string {
  return join(app.getPath('userData'), 'diag-level')
}

function lastRefFile(): string {
  return join(app.getPath('userData'), 'diag-last-ref')
}

// Server refs look like diag-1a2b3c; anything else is ignored.
const REF_RE = /^diag-[0-9a-f]{6,64}$/

// The reference of the last bundle the user sent from Settings, so a feedback
// report can point at it. Survives restarts; null when none was ever sent.
export function lastDiagRef(): string | null {
  try {
    const ref = readFileSync(lastRefFile(), 'utf8').trim()
    return REF_RE.test(ref) ? ref : null
  } catch {
    return null
  }
}

function rememberRef(ref: string): void {
  if (!REF_RE.test(ref)) return
  try {
    writeFileSync(lastRefFile(), ref)
  } catch {
    /* best effort */
  }
}

export function getLevel(): DiagLevel {
  try {
    const v = readFileSync(levelFile(), 'utf8').trim()
    if (v === 'errors' || v === 'verbose') return v
  } catch {
    /* default off */
  }
  return 'off'
}

export function setLevel(level: DiagLevel): void {
  try {
    writeFileSync(levelFile(), level)
  } catch {
    /* best effort */
  }
  restartStreaming()
}

async function post(payload: unknown): Promise<{ ref: string }> {
  const endpoint = requireServiceEndpoint('diag')
  const lease = currentLease()
  const gz = gzipSync(Buffer.from(JSON.stringify(payload)))
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...(lease !== null ? { 'X-Iblis-Lease': lease } : {}),
      'Content-Type': 'application/gzip',
      'Content-Encoding': 'gzip'
    },
    body: gz,
    // Our diag host does not redirect; refuse so a bounce can't forward the
    // lease or the bundle to another origin.
    redirect: 'error'
  })
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`)
  const body = (await res.json()) as { ok?: boolean; ref?: string; error?: string }
  if (!body.ok || !body.ref) throw new Error(body.error ?? 'upload rejected')
  return { ref: body.ref }
}

// Phase A — one full bundle on demand (the Settings "Send diagnostics" button).
export async function send(note?: string): Promise<{ ref: string }> {
  const level = getLevel()
  if (level === 'off') throw new Error('diagnostics are off — turn them on in Settings first')
  const bundle = await buildBundle(level, note)
  const r = await post(bundle)
  rememberRef(r.ref)
  log('info', 'diagnostics bundle sent', { ref: r.ref, level })
  return r
}

// --- Phase B — opt-in streaming + crash capture ----------------------------
let timer: ReturnType<typeof setInterval> | null = null

// A lightweight batch of recent breadcrumbs, schema-tagged so the reader can
// tell it from a full bundle. Best-effort: never throws into the caller.
function streamBatch(reason: string): void {
  const level = getLevel()
  if (level === 'off') return
  const events = recentEvents()
  if (events.length === 0 && reason === 'tick') return
  const batch = redactValue(
    {
      schema: DIAG_SCHEMA,
      kind: 'stream',
      reason,
      installId: getInstallId(),
      level,
      sentAt: new Date().toISOString(),
      events
    },
    level
  )
  void post(batch).catch(() => {
    /* streaming is best-effort; a failed flush must not disrupt the app */
  })
}

function restartStreaming(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // Continuous streaming is the loud "live test session" tier only.
  if (getLevel() === 'verbose') {
    timer = setInterval(() => streamBatch('tick'), STREAM_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
  }
}

// Wire crash capture + the error-triggered flush + streaming. Call once at boot.
export function initDiagnostics(): void {
  // An error-level log flushes breadcrumbs immediately (Sentry-style).
  setErrorHook(() => streamBatch('error'))

  const onCrash = (kind: string) => (e: unknown) => {
    log('error', `uncaught ${kind}`, { error: String((e as Partial<Error> | null)?.stack ?? e) })
    streamBatch('crash')
  }
  process.on('uncaughtException', onCrash('exception'))
  process.on('unhandledRejection', onCrash('rejection'))

  restartStreaming()
}
