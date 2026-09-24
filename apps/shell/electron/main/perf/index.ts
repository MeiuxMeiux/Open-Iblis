// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { cpus } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PerfInfo, PerfProfile, PerfSettings } from '../../../shared/contract'

// User-facing engine performance profile. The one lever the app cleanly owns is
// how many CPU worker threads a native engine's OpenMP pool may use
// (OMP_NUM_THREADS, honoured by the ggml-cpu backend with no engine flag).
//
// Why expose it: the ggml-cpu backend otherwise spawns a worker on EVERY logical
// core and pins them at 100% through the prefill + text-encode blocks. On a box
// with marginal cooling/power (or early-silicon firmware) that all-core
// saturation is exactly the load that surfaces a latent CPU fault as a
// CLOCK_WATCHDOG_TIMEOUT (0x101) / KMODE_EXCEPTION (0x1e) BSOD. Different
// machines tolerate different loads, so the ceiling has to be the user's to set.
// Lowering it trades a little speed in those CPU blocks for a responsive,
// non-crashing box. Applied at spawn time, so a change needs an engine restart.

// Cores left free for the OS/shell/GPU-submit thread under the 'balanced' default.
const CORE_HEADROOM = 2

const DEFAULTS: PerfSettings = { profile: 'balanced', customThreads: 0 }
const PROFILES: readonly PerfProfile[] = ['safe', 'balanced', 'max', 'custom']

function settingsFile(): string {
  return join(app.getPath('userData'), 'perf-settings.json')
}

function isProfile(value: unknown): value is PerfProfile {
  return (PROFILES as readonly unknown[]).includes(value)
}

function getPerf(): PerfSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<PerfSettings>
    const profile = isProfile(raw.profile) ? raw.profile : DEFAULTS.profile
    const customThreads =
      typeof raw.customThreads === 'number' && Number.isInteger(raw.customThreads)
        ? Math.max(0, raw.customThreads)
        : DEFAULTS.customThreads
    return { profile, customThreads }
  } catch {
    return { ...DEFAULTS }
  }
}

// `next` arrives over IPC: the profile is unverified and customThreads may be missing.
export function setPerf(next: { profile: unknown; customThreads?: number }): PerfInfo {
  if (!isProfile(next.profile))
    throw new Error(`unknown performance profile: ${String(next.profile)}`)
  const n = cores()
  const customThreads = clamp(Math.trunc(next.customThreads ?? 0), 0, n)
  writeFileSync(settingsFile(), JSON.stringify({ profile: next.profile, customThreads }))
  return perfInfo()
}

function cores(): number {
  return Math.max(1, cpus().length)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

// Resolve the current settings to a concrete OMP thread count for this machine.
export function resolveThreadCap(settings: PerfSettings = getPerf()): number {
  const n = cores()
  switch (settings.profile) {
    case 'max':
      return n
    case 'safe':
      // Heavy throttle: roughly the P-core count on hybrid Intel parts, the
      // "back right off so the box survives" setting. Aim for at least 2, but
      // never above Balanced — on a small machine Safe must still be the
      // lightest profile.
      return Math.min(Math.max(1, n - CORE_HEADROOM), Math.max(2, Math.floor(n / 3)))
    case 'custom':
      return clamp(settings.customThreads || 1, 1, n)
    case 'balanced':
    default:
      return Math.max(1, n - CORE_HEADROOM)
  }
}

// What the Settings panel needs: the saved choice, this machine's core count,
// and the concrete thread count each fixed profile resolves to here (so the UI
// can show "Safe — 8 threads" without duplicating the formula).
export function perfInfo(): PerfInfo {
  return {
    settings: getPerf(),
    logicalCores: cores(),
    threads: {
      safe: resolveThreadCap({ profile: 'safe', customThreads: 0 }),
      balanced: resolveThreadCap({ profile: 'balanced', customThreads: 0 }),
      max: resolveThreadCap({ profile: 'max', customThreads: 0 })
    }
  }
}
