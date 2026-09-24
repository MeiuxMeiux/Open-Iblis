// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

export interface QueueLeases {
  readonly inhibited: boolean
  inhibit(blockedReason?: string): () => Promise<void>
  acquireAdmission(): () => Promise<void>
  drain(): Promise<void>
}

export function createQueueLeases(): QueueLeases {
  let inhibitions = 0
  let admissions = 0
  const waiters = new Set<() => void>()

  function notify(): void {
    if (inhibitions > 0 || admissions > 0) return
    for (const resolve of waiters) resolve()
    waiters.clear()
  }

  function release(kind: 'inhibition' | 'admission'): () => Promise<void> {
    let released = false
    return async () => {
      if (released) return
      released = true
      if (kind === 'inhibition') inhibitions = Math.max(0, inhibitions - 1)
      else admissions = Math.max(0, admissions - 1)
      notify()
    }
  }

  return {
    get inhibited(): boolean {
      return inhibitions > 0
    },
    inhibit(blockedReason): () => Promise<void> {
      if (blockedReason) throw new Error(blockedReason)
      if (admissions > 0) {
        throw new Error('engine changes are unavailable while generation work is being admitted')
      }
      inhibitions++
      return release('inhibition')
    },
    acquireAdmission(): () => Promise<void> {
      if (inhibitions > 0) throw new Error('generation admission is paused for an engine change')
      admissions++
      return release('admission')
    },
    drain(): Promise<void> {
      if (inhibitions === 0 && admissions === 0) return Promise.resolve()
      return new Promise<void>((resolve) => waiters.add(resolve))
    }
  }
}
