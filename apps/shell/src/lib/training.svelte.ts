// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  TrainingJobView,
  TrainingProgressEvent,
  TrainingStartInput
} from '../../shared/training'

// Training jobs store: one push-updated list plus the live progress event.
let jobs = $state<TrainingJobView[]>([])
let progress = $state<TrainingProgressEvent | null>(null)
let loaded = $state(false)
let error = $state<string | null>(null)
let subscribed = false
let receivedPush = false

function activeStatus(job: TrainingJobView): boolean {
  return job.status === 'running' || job.status === 'uploading'
}

export const training = {
  get jobs(): TrainingJobView[] {
    return jobs
  },
  get active(): TrainingJobView | null {
    return jobs.find(activeStatus) ?? null
  },
  get history(): TrainingJobView[] {
    return jobs.filter((job) => !activeStatus(job))
  },
  get progress(): TrainingProgressEvent | null {
    return progress
  },
  get loaded(): boolean {
    return loaded
  },
  get error(): string | null {
    return error
  },

  async initialize(): Promise<void> {
    if (!subscribed) {
      subscribed = true
      window.iblis.training.onJobs((next: TrainingJobView[]) => {
        receivedPush = true
        jobs = next
        loaded = true
      })
      window.iblis.training.onProgress((event: TrainingProgressEvent) => {
        progress = event
      })
    }
    try {
      const result = await window.iblis.training.list()
      if (result.ok) {
        if (!receivedPush) jobs = result.data
      } else if (!receivedPush) {
        error = result.error
      }
    } catch (cause) {
      if (!receivedPush) error = cause instanceof Error ? cause.message : String(cause)
    }
    loaded = true
  },

  async start(input: TrainingStartInput): Promise<{ ok: boolean; error?: string }> {
    // The wizard's categories/advanced are $state proxies, which IPC's
    // structured clone refuses.
    const result = await window.iblis.training.start($state.snapshot(input))
    return result.ok ? { ok: true } : { ok: false, error: result.error }
  },

  async cancel(jobId: string): Promise<void> {
    const result = await window.iblis.training.cancel(jobId)
    if (!result.ok) error = result.error
  },

  async resume(jobId: string): Promise<void> {
    const result = await window.iblis.training.resume(jobId)
    if (!result.ok) error = result.error
  },

  async deleteJob(jobId: string): Promise<void> {
    const result = await window.iblis.training.deleteJob(jobId)
    if (!result.ok) error = result.error
  },

  async retryUpload(jobId: string): Promise<void> {
    const result = await window.iblis.training.retryUpload(jobId)
    if (!result.ok) error = result.error
  }
}
