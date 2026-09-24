// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { QueueEntry } from '../../../shared/generation-queue'

export function terminal(entry: QueueEntry): boolean {
  return ['done', 'failed', 'cancelled', 'interrupted'].includes(entry.status)
}

export function queueLabel(entry: QueueEntry): string {
  const labels: Record<QueueEntry['status'], string> = {
    pending: 'Pending',
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Stopped',
    interrupted: 'Interrupted'
  }
  if (entry.status !== 'running' || !entry.job) return labels[entry.status]
  const phases = {
    queued: 'Starting',
    lm: 'Composing',
    synth: 'Rendering',
    finishing: 'Finishing',
    done: 'Done',
    error: 'Failed'
  } as const
  return phases[entry.job.status]
}

export function queueDescription(entry: QueueEntry): string {
  if (entry.comparison && !entry.comparison.revealed) return 'Controlled variant hidden'
  const bits = [`${entry.request.durationSec}s`]
  if (entry.request.preset) bits.push(entry.request.preset)
  if (entry.request.config?.steps !== undefined) bits.push(`${entry.request.config.steps} steps`)
  if (entry.request.seed !== undefined) bits.push(`seed ${entry.request.seed}`)
  if (entry.request.config?.guidance !== undefined) {
    bits.push(`CFG ${entry.request.config.guidance}`)
  }
  if (entry.request.config?.shift !== undefined) bits.push(`shift ${entry.request.config.shift}`)
  if (entry.request.config?.solver) bits.push(entry.request.config.solver)
  if (entry.request.config?.lmSeed !== undefined)
    bits.push(`LM seed ${entry.request.config.lmSeed}`)
  if (entry.request.config?.synthModel) bits.push(entry.request.config.synthModel)
  // A queued take is auditable before it runs: the style rides along by its
  // registry name (which resolves to the library record and its origin).
  if (entry.request.config?.adapter) {
    const scale = entry.request.config.adapterScale
    bits.push(`style ${entry.request.config.adapter}${scale !== undefined ? ` @ ${scale}` : ''}`)
  }
  return bits.join(' · ')
}

export function queueTitle(entry: QueueEntry, fallback: string): string {
  return entry.comparison ? `Candidate ${entry.comparison.blindLabel} · ${fallback}` : fallback
}
