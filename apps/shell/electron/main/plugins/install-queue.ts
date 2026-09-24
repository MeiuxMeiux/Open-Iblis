// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The catalog can contain several multi-gigabyte packs. Keep their transfers
// civil to a user's disk and connection by admitting one install at a time.
// This is deliberately independent from Electron so its FIFO/cancel semantics
// stay easy to prove in a unit test. It also retains a small terminal history:
// a vanished failed job is indistinguishable from a stalled UI to a user.

import type {
  PluginInstallHistoryEntry,
  PluginInstallQueueEntry,
  PluginInstallQueueSnapshot
} from '../../../shared/plugin-install-queue'

export type { PluginInstallHistoryEntry, PluginInstallQueueEntry, PluginInstallQueueSnapshot }

const HISTORY_LIMIT = 12

interface Job<T> {
  id: string
  version: string
  controller: AbortController
  run: (signal: AbortSignal) => Promise<T>
  cancelled: () => T
  failed: (error: unknown) => T
  describe: (value: T) => Omit<PluginInstallHistoryEntry, 'id' | 'version' | 'finishedAt'>
  resolve: (value: T) => void
}

export class PluginInstallQueue<T> {
  private active: Job<T> | null = null
  private readonly waiting: Job<T>[] = []
  private readonly history: PluginInstallHistoryEntry[] = []
  private readonly listeners = new Set<(snapshot: PluginInstallQueueSnapshot) => void>()

  entries(): PluginInstallQueueEntry[] {
    const active = this.active
      ? [
          {
            id: this.active.id,
            version: this.active.version,
            phase: 'installing' as const,
            position: 0
          }
        ]
      : []
    return [
      ...active,
      ...this.waiting.map((job, index) => ({
        id: job.id,
        version: job.version,
        phase: 'queued' as const,
        position: index + (this.active ? 1 : 0)
      }))
    ]
  }

  snapshot(): PluginInstallQueueSnapshot {
    return { entries: this.entries(), history: [...this.history] }
  }

  subscribe(listener: (snapshot: PluginInstallQueueSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueue(
    id: string,
    version: string,
    run: (signal: AbortSignal) => Promise<T>,
    cancelled: () => T,
    failed: (error: unknown) => T,
    describe: (value: T) => Omit<PluginInstallHistoryEntry, 'id' | 'version' | 'finishedAt'>
  ): Promise<T> {
    if (this.entries().some((entry) => entry.id === id)) {
      return Promise.reject(new Error('plugin install is already queued'))
    }
    return new Promise<T>((resolve) => {
      this.waiting.push({
        id,
        version,
        controller: new AbortController(),
        run,
        cancelled,
        failed,
        describe,
        resolve
      })
      this.emit()
      void this.pump()
    })
  }

  cancel(id: string): boolean {
    if (this.active?.id === id) {
      this.active.controller.abort()
      return true
    }
    const index = this.waiting.findIndex((job) => job.id === id)
    if (index < 0) return false
    const [job] = this.waiting.splice(index, 1)
    if (!job) return false
    job.controller.abort()
    const result = job.cancelled()
    job.resolve(result)
    this.record(job, result)
    this.emit()
    return true
  }

  private async pump(): Promise<void> {
    if (this.active) return
    const next = this.waiting.shift()
    if (!next) return
    this.active = next
    this.emit()
    let result: T
    try {
      result = await next.run(next.controller.signal)
    } catch (error) {
      result = next.failed(error)
    }
    next.resolve(result)
    this.record(next, result)
    // Finish broadcasting before the next job starts so the manager never
    // skips a terminal result when a fast queued job follows it.
    this.active = null
    this.emit()
    void this.pump()
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private record(job: Job<T>, result: T): void {
    this.history.unshift({
      id: job.id,
      version: job.version,
      finishedAt: Date.now(),
      ...job.describe(result)
    })
    this.history.length = Math.min(this.history.length, HISTORY_LIMIT)
  }
}
