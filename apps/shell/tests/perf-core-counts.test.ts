// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest'

// The ordering contract must hold on every machine, not just the one running
// the suite: CI runners and small laptops have few cores, where a fixed
// "never below 2" floor used to push Safe above Balanced.

const os = vi.hoisted(() => ({ count: 1 }))
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>()
  return { ...real, cpus: () => Array.from({ length: os.count }, () => real.cpus()[0]!) }
})

const { resolveThreadCap } = await import('../electron/main/perf')

describe('resolveThreadCap across core counts', () => {
  for (const count of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32]) {
    it(`orders safe <= balanced <= max with ${count} cores`, () => {
      os.count = count
      const safe = resolveThreadCap({ profile: 'safe', customThreads: 0 })
      const balanced = resolveThreadCap({ profile: 'balanced', customThreads: 0 })
      const max = resolveThreadCap({ profile: 'max', customThreads: 0 })
      expect(safe).toBeGreaterThanOrEqual(1)
      expect(safe).toBeLessThanOrEqual(balanced)
      expect(balanced).toBeLessThanOrEqual(max)
      expect(max).toBe(count)
    })
  }
})
