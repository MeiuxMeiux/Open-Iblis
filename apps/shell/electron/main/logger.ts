// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { appendFileSync, mkdirSync, createWriteStream, type WriteStream } from 'node:fs'
import { join } from 'node:path'

// Structured JSON logs in %APPDATA%/Iblis/logs/ (see architecture.md).
// Best-effort: a failed file write must never crash the app.

type Level = 'debug' | 'info' | 'warn' | 'error'

let logDir: string | null = null

// In-memory ring buffer of recent events — the "breadcrumbs" the diagnostics
// streamer flushes and the crash handler attaches before the process dies
// (docs/feature/diagnostics.md Phase B). Bounded so it can never blow up memory.
const RING_MAX = 500
const ring: string[] = []
let logged = 0 // events ever pushed; a cursor for "what is new since"
let onErrorEvent: (() => void) | null = null

export function recentEvents(): string[] {
  return ring.slice()
}

// Events logged after `cursor` (a previous `next`), oldest first, plus the new
// cursor. Lets the streamer send each breadcrumb once instead of re-sending
// the whole ring every tick. Events already rotated out of the ring are lost.
export function eventsSince(cursor: number): { events: string[]; next: number } {
  const fresh = Math.min(Math.max(logged - cursor, 0), ring.length)
  return { events: fresh === 0 ? [] : ring.slice(ring.length - fresh), next: logged }
}

// The diagnostics module registers a callback here so an `error`-level event can
// trigger an immediate stream flush without logger importing diag (no cycle).
export function setErrorHook(fn: (() => void) | null): void {
  onErrorEvent = fn
}

function dir(): string {
  if (logDir === null) {
    logDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

// Append-mode stream for one sidecar's stdout+stderr. Capturing the output is
// the only way a native engine's launch failure explains itself; just as
// important, *reading* the pipes drains them — an unread stdout/stderr fills its
// OS pipe buffer (~64 KB on Windows) and blocks the child mid-startup, so it
// never finishes loading and never reports healthy.
export function sidecarLog(id: string): WriteStream {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_')
  return createWriteStream(join(dir(), `sidecar-${safe}.log`), { flags: 'a' })
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
  ring.push(line)
  logged++
  if (ring.length > RING_MAX) ring.shift()
  try {
    appendFileSync(join(dir(), 'main.log'), line + '\n')
  } catch {
    // logging must never throw
  }
  if (level === 'error' && onErrorEvent) {
    try {
      onErrorEvent()
    } catch {
      // a flush failure must never break logging
    }
  }
}
