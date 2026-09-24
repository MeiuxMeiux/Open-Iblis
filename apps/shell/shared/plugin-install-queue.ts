// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

export interface PluginInstallQueueEntry {
  id: string
  version: string
  phase: 'queued' | 'installing'
  position: number
}

type PluginInstallOutcome = 'completed' | 'cancelled' | 'failed'

// Recent terminal work stays visible after it leaves the FIFO. This gives the
// Downloads view an honest answer when an install has failed instead of making
// an entry simply disappear.
export interface PluginInstallHistoryEntry {
  id: string
  version: string
  outcome: PluginInstallOutcome
  finishedAt: number
  message?: string
}

export interface PluginInstallQueueSnapshot {
  entries: PluginInstallQueueEntry[]
  history: PluginInstallHistoryEntry[]
}
