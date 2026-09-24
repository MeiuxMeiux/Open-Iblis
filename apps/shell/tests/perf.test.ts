// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect } from 'vitest'
import { cpus } from 'node:os'
import { resolveThreadCap, perfInfo } from '../electron/main/perf'

// The performance profile is a safety lever on marginal hardware, so the
// resolver's contract matters: lower profiles must never resolve higher than
// higher ones, and custom must stay within [1, cores]. Pure logic — no fs/IPC.

const N = Math.max(1, cpus().length)

describe('resolveThreadCap', () => {
  it('max uses every logical core', () => {
    expect(resolveThreadCap({ profile: 'max', customThreads: 0 })).toBe(N)
  })

  it('balanced leaves headroom (cores - 2, floored at 1)', () => {
    expect(resolveThreadCap({ profile: 'balanced', customThreads: 0 })).toBe(Math.max(1, N - 2))
  })

  it('safe heavily throttles (~third of cores, aims for 2, never above balanced)', () => {
    expect(resolveThreadCap({ profile: 'safe', customThreads: 0 })).toBe(
      Math.min(Math.max(1, N - 2), Math.max(2, Math.floor(N / 3)))
    )
  })

  it('orders safe <= balanced <= max', () => {
    const safe = resolveThreadCap({ profile: 'safe', customThreads: 0 })
    const balanced = resolveThreadCap({ profile: 'balanced', customThreads: 0 })
    const max = resolveThreadCap({ profile: 'max', customThreads: 0 })
    expect(safe).toBeLessThanOrEqual(balanced)
    expect(balanced).toBeLessThanOrEqual(max)
  })

  it('custom clamps above the core count and below 1', () => {
    expect(resolveThreadCap({ profile: 'custom', customThreads: N + 99 })).toBe(N)
    expect(resolveThreadCap({ profile: 'custom', customThreads: 0 })).toBe(1)
    expect(resolveThreadCap({ profile: 'custom', customThreads: -5 })).toBe(1)
  })
})

describe('perfInfo', () => {
  it('reports this machine and per-profile thread counts that match the resolver', () => {
    const info = perfInfo()
    expect(info.logicalCores).toBe(N)
    expect(info.threads.safe).toBe(resolveThreadCap({ profile: 'safe', customThreads: 0 }))
    expect(info.threads.balanced).toBe(resolveThreadCap({ profile: 'balanced', customThreads: 0 }))
    expect(info.threads.max).toBe(resolveThreadCap({ profile: 'max', customThreads: 0 }))
  })
})
