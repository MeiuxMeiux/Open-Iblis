// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ChildProcess } from 'node:child_process'
import { SESSION_HEADER, type PluginManifest } from '@iblis/plugin-sdk'
import type { SidecarHealth } from '../../../shared/contract'
import { launch, type Instance } from './instance'
import { log } from '../logger'
import { errorMessage } from '../error-message'
import { withCredentialHeader } from '../request-headers'

// Owns the live sidecar processes. One per plugin id. Handles zero-downtime
// hot-swap, crash-restart with a circuit breaker, and kill-on-quit.

const RESTART_LIMIT = 3 // crashes within the window before the breaker opens
const RESTART_WINDOW_MS = 60_000
const STOP_GRACE_MS = 5000

interface Supervised {
  instance: Instance
  manifest: PluginManifest
  crashes: number[]
  breakerOpen: boolean
  stopping: boolean
}

const running = new Map<string, Supervised>()
export interface SidecarLifecycleEvent {
  id: string
  type: 'unexpected_exit' | 'circuit_open'
}
const lifecycleListeners = new Set<(event: SidecarLifecycleEvent) => void>()

export function onSidecarLifecycle(listener: (event: SidecarLifecycleEvent) => void): () => void {
  lifecycleListeners.add(listener)
  return () => lifecycleListeners.delete(listener)
}

function notifyLifecycle(event: SidecarLifecycleEvent): void {
  for (const listener of lifecycleListeners) {
    try {
      listener(event)
    } catch (error) {
      log('error', 'sidecar lifecycle listener failed', {
        id: event.id,
        type: event.type,
        error: errorMessage(error)
      })
    }
  }
}

export function portOf(id: string): number | null {
  return running.get(id)?.instance.port ?? null
}

// Snapshot of every live sidecar, keyed by plugin id, for the Plugins UI.
export function healthAll(): Record<string, SidecarHealth> {
  const out: Record<string, SidecarHealth> = {}
  for (const [id, sup] of running) {
    out[id] = {
      running: !sup.breakerOpen,
      port: sup.instance.port,
      version: sup.manifest.version,
      breakerOpen: sup.breakerOpen
    }
  }
  return out
}

// Authenticated request to a running sidecar — the only way the rest of the app
// reaches one (the per-session secret is attached here, never exposed upward).
export function requestSidecar(
  id: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const sup = running.get(id)
  if (!sup) throw new Error(`no running sidecar for ${id}`)
  const headers = withCredentialHeader(init.headers, SESSION_HEADER, sup.instance.secret)
  return fetch(`http://127.0.0.1:${sup.instance.port}${path}`, { ...init, headers })
}

// Test/diagnostic seam: hard-kill the live child to exercise crash-restart.
export function simulateCrash(id: string): void {
  running.get(id)?.instance.child.kill('SIGKILL')
}

export async function start(manifest: PluginManifest): Promise<void> {
  if (!manifest.executable || running.has(manifest.id)) return
  const instance = await launch(manifest)
  const sup: Supervised = { instance, manifest, crashes: [], breakerOpen: false, stopping: false }
  running.set(manifest.id, sup)
  watch(sup)
  log('info', 'sidecar started', {
    id: manifest.id,
    version: manifest.version,
    port: instance.port
  })
}

// Bring the new version up healthy on a new port BEFORE retiring the old one.
// If the new one fails to launch, the old keeps serving and the error bubbles.
export async function hotSwap(manifest: PluginManifest): Promise<void> {
  const old = running.get(manifest.id)
  if (!old) return start(manifest)

  const next = await launch(manifest)
  old.stopping = true
  await kill(old.instance.child)

  const sup: Supervised = {
    instance: next,
    manifest,
    crashes: [],
    breakerOpen: false,
    stopping: false
  }
  running.set(manifest.id, sup)
  watch(sup)
  log('info', 'sidecar hot-swapped', {
    id: manifest.id,
    version: manifest.version,
    port: next.port
  })
}

export async function stop(id: string): Promise<void> {
  const sup = running.get(id)
  if (!sup) return
  sup.stopping = true
  await kill(sup.instance.child)
  running.delete(id)
  log('info', 'sidecar stopped', { id })
}

export async function stopAll(): Promise<void> {
  await Promise.all([...running.keys()].map((id) => stop(id)))
}

function watch(sup: Supervised): void {
  sup.instance.child.once('exit', (code, signal) => {
    if (sup.stopping) return
    log('warn', 'sidecar exited unexpectedly', { id: sup.instance.id, code, signal })
    notifyLifecycle({ id: sup.instance.id, type: 'unexpected_exit' })
    void onCrash(sup)
  })
}

async function onCrash(sup: Supervised): Promise<void> {
  const now = Date.now()
  sup.crashes = sup.crashes.filter((t) => now - t < RESTART_WINDOW_MS)
  sup.crashes.push(now)
  if (sup.crashes.length > RESTART_LIMIT) {
    sup.breakerOpen = true
    notifyLifecycle({ id: sup.instance.id, type: 'circuit_open' })
    log('error', 'sidecar circuit breaker open — not restarting', { id: sup.instance.id })
    return
  }
  try {
    sup.instance = await launch(sup.manifest)
    watch(sup)
    log('info', 'sidecar restarted', { id: sup.instance.id, port: sup.instance.port })
  } catch (e) {
    log('error', 'sidecar restart failed', {
      id: sup.instance.id,
      error: errorMessage(e)
    })
  }
}

// SIGTERM, then SIGKILL if it has not exited within the grace period.
function kill(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}
