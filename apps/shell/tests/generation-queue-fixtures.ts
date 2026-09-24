// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { GenerateRequest, JobState } from '@iblis/plugin-sdk'
import type { QueueDocument, QueueTarget } from '../shared/generation-queue'
import type { QueueRecipeRules } from '../electron/main/engine/provider'
import type { QueueEngine } from '../electron/main/generation-queue/scheduler'
import type { QueueStore } from '../electron/main/generation-queue/store'
import { canonicalRequestError } from '../electron/main/engine/drivers/ace-compat/request'
import { validComparisonBlueprint } from '../electron/main/engine/drivers/ace-compat/protocol'
import {
  comparisonRecipeError,
  isComparisonControl
} from '../electron/main/engine/drivers/ace-compat/comparison'

// The real ACE recipe rules, exactly as the provider hands them to the store.
export const aceQueueRules: QueueRecipeRules = {
  canonicalRequestError,
  validBlueprint: validComparisonBlueprint,
  isComparisonControl,
  comparisonRecipeError
}

export const request = (prompt: string): GenerateRequest => ({
  prompt,
  durationSec: 30,
  preset: 'fast',
  config: { steps: 8 }
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function memoryStore(seed?: QueueDocument): QueueStore {
  const initial: QueueDocument = seed ?? { version: 2, paused: false, entries: [] }
  let document: QueueDocument = clone(initial)
  return {
    async load() {
      return { document: clone(document), corrupt: false }
    },
    async replace(next) {
      document = clone(next)
    }
  }
}

export class FakeEngine implements QueueEngine {
  starts: { id: string; request: GenerateRequest; target?: QueueTarget }[] = []
  maximumActive = 0
  private active = 0
  private jobs = new Map<
    string,
    { state: JobState; promise: Promise<JobState>; resolve: (state: JobState) => void }
  >()

  start(value: GenerateRequest, _blueprint?: string, target?: QueueTarget): { jobId: string } {
    const id = `job-${this.starts.length + 1}`
    let resolve!: (state: JobState) => void
    const promise = new Promise<JobState>((done) => (resolve = done))
    const state: JobState = { status: 'lm', progress: 0.1 }
    this.jobs.set(id, { state, promise, resolve })
    this.starts.push({ id, request: clone(value), ...(target ? { target: clone(target) } : {}) })
    this.active++
    this.maximumActive = Math.max(this.maximumActive, this.active)
    return { jobId: id }
  }

  state(jobId: string): JobState | undefined {
    return this.jobs.get(jobId)?.state
  }

  settled(jobId: string): Promise<JobState | undefined> {
    return this.jobs.get(jobId)?.promise ?? Promise.resolve(undefined)
  }

  async cancel(jobId: string): Promise<void> {
    this.finish(jobId, {
      status: 'error',
      progress: this.jobs.get(jobId)?.state.progress ?? 0,
      error: { code: 'job_cancelled', message: 'stopped' }
    })
  }

  finish(jobId: string, state: JobState = { status: 'done', progress: 1 }): void {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error(`unknown fake job ${jobId}`)
    job.state = state
    this.active--
    job.resolve(state)
  }
}

export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 1000; index++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition did not become true')
}
