// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GenerateRequest, JobState } from '@iblis/plugin-sdk'
import type { QueueDocument, QueueInsert } from '../shared/generation-queue'
import {
  createGenerationQueueScheduler,
  type QueueEngine
} from '../electron/main/generation-queue/scheduler'
import {
  createGenerationQueueStore,
  type QueueStore
} from '../electron/main/generation-queue/store'
import { aceQueueRules } from './generation-queue-fixtures'

const BLUEPRINT = JSON.stringify([{ audio_codes: 'saved-codes', caption: 'same blueprint' }])
const request = (steps: 8 | 20): GenerateRequest => ({
  prompt: 'same blueprint',
  durationSec: 30,
  preset: steps === 8 ? 'turbo-validated' : 'turbo-expert',
  seed: 10,
  config: {
    steps,
    lmSeed: 20,
    guidance: 1,
    shift: 3,
    solver: 'euler',
    temperature: 0.85,
    rewritePrompt: true,
    autoLyrics: false,
    lmModel: 'lm.gguf',
    synthModel: 'turbo.gguf',
    adapterScale: 1
  }
})
const pair = (groupId: string): QueueInsert[] => [
  {
    request: request(8),
    comparison: { groupId, blindLabel: 'B', revealed: false }
  },
  {
    request: request(20),
    comparison: { groupId, blindLabel: 'A', revealed: false }
  }
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function memoryStore(seed: QueueDocument): QueueStore {
  let document = clone(seed)
  return {
    async load() {
      return { document: clone(document), corrupt: false }
    },
    async replace(next) {
      document = clone(next)
    }
  }
}

class BlueprintEngine implements QueueEngine {
  starts: { request: GenerateRequest; blueprint?: string }[] = []

  start(request: GenerateRequest, blueprint?: string): { jobId: string } {
    this.starts.push({ request: clone(request), ...(blueprint ? { blueprint } : {}) })
    return { jobId: `blueprint-job-${this.starts.length}` }
  }

  state(): JobState {
    return { status: 'done', progress: 1 }
  }

  settled(): Promise<JobState> {
    return Promise.resolve({ status: 'done', progress: 1 })
  }

  async cancel(): Promise<void> {}

  blueprint(jobId: string): string | undefined {
    return jobId === 'blueprint-job-1' ? BLUEPRINT : undefined
  }
}

const idleEngine: QueueEngine = {
  start: () => {
    throw new Error('unexpected engine start')
  },
  state: () => undefined,
  settled: async () => undefined,
  cancel: async () => {}
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 1000; index++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition did not become true')
}

describe('generation comparison blueprint persistence', () => {
  it('persists the first LM blueprint and reuses it for the paired candidate', async () => {
    const engine = new BlueprintEngine()
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: false, entries: [] }),
      engine,
      sleep: () => Promise.resolve()
    })
    await queue.init()
    await queue.enqueueBatch(pair('live'))
    await waitFor(() => queue.snapshot().entries.every((entry) => entry.status === 'done'))

    expect(engine.starts).toHaveLength(2)
    expect(engine.starts[0]?.blueprint).toBeUndefined()
    expect(engine.starts[1]?.blueprint).toBe(BLUEPRINT)
    expect(queue.snapshot().entries.every((entry) => !entry.comparison?.internalBlueprint)).toBe(
      true
    )
  })

  it('rehydrates a saved blueprint after restart without exposing it in snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iblis-comparison-restart-'))
    try {
      const store = createGenerationQueueStore(join(root, 'generation-queue.json'), aceQueueRules)
      const [finished, waiting] = pair('restart')
      waiting!.comparison!.internalBlueprint = BLUEPRINT
      await store.replace({
        version: 2,
        paused: false,
        entries: [
          {
            id: 'finished',
            ...finished!,
            status: 'done',
            createdAt: 1,
            updatedAt: 2,
            finishedAt: 2
          },
          { id: 'waiting', ...waiting!, status: 'pending', createdAt: 1, updatedAt: 2 }
        ]
      })
      const engine = new BlueprintEngine()
      const queue = createGenerationQueueScheduler({
        store,
        engine,
        sleep: () => Promise.resolve()
      })
      await queue.init()
      expect(queue.snapshot().entries.every((entry) => !entry.comparison?.internalBlueprint)).toBe(
        true
      )
      await waitFor(() => queue.snapshot().entries.every((entry) => entry.status === 'done'))
      expect(engine.starts[0]?.blueprint).toBe(BLUEPRINT)
      await queue.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed instead of regenerating LM when a paired blueprint is missing', async () => {
    const [finished, waiting] = pair('missing')
    const entries: QueueDocument['entries'] = [
      {
        id: 'finished',
        ...finished!,
        status: 'done',
        createdAt: 1,
        updatedAt: 2,
        finishedAt: 2
      },
      { id: 'waiting', ...waiting!, status: 'pending', createdAt: 1, updatedAt: 2 }
    ]
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: false, entries }),
      engine: idleEngine
    })
    await queue.init()
    await waitFor(() => queue.snapshot().entries[1]?.status === 'failed')
    expect(queue.snapshot()).toMatchObject({
      paused: true,
      entries: [{ status: 'done' }, { error: { code: 'queue_engine_error' } }]
    })
  })
})
