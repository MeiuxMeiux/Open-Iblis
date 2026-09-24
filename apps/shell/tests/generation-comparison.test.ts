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
  buildBlindComparison,
  MAX_UNREVEALED_COMPARISONS
} from '../electron/main/generation-queue/comparison'
import {
  comparisonRecipeError,
  sameComparisonBlueprint
} from '../electron/main/engine/drivers/ace-compat/comparison'
import { aceQueueRules } from './generation-queue-fixtures'
import {
  createGenerationQueueStore,
  type QueueStore
} from '../electron/main/generation-queue/store'

const request = (prompt: string, steps = 8): GenerateRequest => ({
  prompt,
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

const pair = (groupId = 'comparison-1'): QueueInsert[] => [
  {
    request: request('same blueprint', 8),
    comparison: { groupId, blindLabel: 'B', revealed: false }
  },
  {
    request: request('same blueprint', 20),
    comparison: { groupId, blindLabel: 'A', revealed: false }
  }
]

const BLUEPRINT = JSON.stringify([{ audio_codes: 'saved-codes', caption: 'same blueprint' }])

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

const idleEngine: QueueEngine = {
  start: () => {
    throw new Error('unexpected engine start')
  },
  state: () => undefined,
  settled: async () => undefined,
  cancel: async () => {}
}

class FinishingEngine implements QueueEngine {
  started = false
  private resolve!: (state: JobState) => void
  private terminal = new Promise<JobState>((done) => (this.resolve = done))

  start(): { jobId: string } {
    this.started = true
    return { jobId: 'comparison-job' }
  }

  state(): JobState {
    return { status: 'synth', progress: 0.5 }
  }

  settled(): Promise<JobState> {
    return this.terminal
  }

  async cancel(): Promise<void> {}

  finish(): void {
    this.resolve({ status: 'done', progress: 1 })
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 1000; index++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('condition did not become true')
}

describe('generation comparison queue', () => {
  it('changes only profile metadata and steps between masked candidates', () => {
    const control = request('same blueprint', 8)
    const candidate: GenerateRequest = {
      ...control,
      preset: 'turbo-expert',
      config: { ...control.config, steps: 20 }
    }
    const candidates = buildBlindComparison(control, candidate, false, 'group')
    expect(candidates.map((entry) => entry.comparison?.blindLabel)).toEqual(['A', 'B'])
    const [experiment, validated] = candidates.map((entry) => entry.request)
    expect(experiment?.preset).toBe('turbo-expert')
    expect(experiment?.config?.steps).toBe(20)
    expect(validated).toEqual(control)
    const omitVariant = (value: GenerateRequest): unknown => {
      const { preset, config, ...rest } = value
      const { steps, ...sameConfig } = config!
      void preset
      void steps
      return { ...rest, config: sameConfig }
    }
    expect(omitVariant(experiment!)).toEqual(omitVariant(validated!))
    expect(sameComparisonBlueprint(control, candidate)).toBe(true)
    expect(
      comparisonRecipeError(control, { ...candidate, prompt: 'different LM input' })
    ).toContain('do not share one LM blueprint')
    expect(comparisonRecipeError(control, { ...control, preset: 'turbo-expert' })).toContain(
      'matches the control'
    )
  })

  it('adds a masked pair atomically or leaves the queue unchanged at the cap', async () => {
    const entries = Array.from({ length: 31 }, (_, index) => ({
      id: `pending-${index}`,
      request: request(`pending ${index}`),
      status: 'pending' as const,
      createdAt: index,
      updatedAt: index
    }))
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: true, entries }),
      engine: idleEngine
    })
    await queue.init()

    await expect(queue.enqueueBatch(pair())).rejects.toThrow('pending cap')
    expect(queue.snapshot().entries).toHaveLength(31)
  })

  it('persists randomized labels and rejects individual candidate edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iblis-comparison-'))
    try {
      const store = createGenerationQueueStore(join(root, 'generation-queue.json'), aceQueueRules)
      await store.replace({ version: 2, paused: true, entries: [] })
      const queue = createGenerationQueueScheduler({ store, engine: idleEngine })
      await queue.init()
      const added = await queue.enqueueBatch(pair())
      const candidate = added.entries[0]!
      await expect(queue.edit(candidate.id, request('changed'))).rejects.toThrow(
        'cannot be changed individually'
      )

      const restored = createGenerationQueueScheduler({ store, engine: idleEngine })
      await restored.init()
      expect(restored.snapshot().entries.map((entry) => entry.comparison)).toEqual(
        pair().map((entry) => entry.comparison)
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reveals both candidates together only after the group is terminal', async () => {
    const pending = pair().map((entry, index) => ({
      id: `candidate-${index}`,
      ...entry,
      status: 'pending' as const,
      createdAt: index,
      updatedAt: index
    }))
    const store = memoryStore({ version: 2, paused: true, entries: pending })
    const queue = createGenerationQueueScheduler({ store, engine: idleEngine })
    await queue.init()
    await expect(queue.revealComparison('comparison-1')).rejects.toThrow('after both')

    const terminal = clone(queue.snapshot().entries).map((entry) => ({
      ...entry,
      status: 'done' as const,
      finishedAt: 10
    }))
    const finished = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: true, entries: terminal }),
      engine: idleEngine
    })
    await finished.init()
    const revealed = await finished.revealComparison('comparison-1')
    expect(revealed.entries.every((entry) => entry.comparison?.revealed)).toBe(true)
  })

  it('preserves an unrevealed terminal pair when finished history is cleared', async () => {
    const entries = pair().map((entry, index) => ({
      id: `candidate-${index}`,
      ...entry,
      status: 'done' as const,
      createdAt: index,
      updatedAt: index,
      finishedAt: 10
    }))
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: true, entries }),
      engine: idleEngine
    })
    await queue.init()

    await queue.clear()
    expect(queue.snapshot().entries).toHaveLength(2)
  })

  it('bounds protected blind history until an older pair is revealed', async () => {
    const entries = Array.from({ length: MAX_UNREVEALED_COMPARISONS }, (_, group) =>
      pair(`group-${group}`).map((entry, candidate) => ({
        id: `candidate-${group}-${candidate}`,
        ...entry,
        status: 'done' as const,
        createdAt: group,
        updatedAt: group,
        finishedAt: group
      }))
    ).flat()
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: true, entries }),
      engine: idleEngine
    })
    await queue.init()

    await expect(queue.enqueueBatch(pair('one-too-many'))).rejects.toThrow('reveal an older')
  })

  it('terminalizes unfinished candidates but retains the masked pair for reveal', async () => {
    const entries = pair().map((entry, index) => ({
      id: `candidate-${index}`,
      ...entry,
      status: index === 0 ? ('failed' as const) : ('pending' as const),
      createdAt: index,
      updatedAt: index
    }))
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: true, entries }),
      engine: idleEngine
    })
    await queue.init()

    const discarded = await queue.discardComparison('comparison-1')
    expect(discarded.entries).toHaveLength(2)
    expect(discarded.entries).toMatchObject([
      { status: 'failed', comparison: { revealed: false } },
      {
        status: 'cancelled',
        error: { code: 'comparison_abandoned' },
        comparison: { revealed: false }
      }
    ])
    const revealed = await queue.revealComparison('comparison-1')
    expect(revealed.entries.every((entry) => entry.comparison?.revealed)).toBe(true)
  })

  it('blocks engine mutation until a pending controlled pair is abandoned', async () => {
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: true, entries: [] }),
      engine: idleEngine
    })
    await queue.init()
    await queue.enqueueBatch(pair())

    await expect(queue.inhibit()).rejects.toThrow('finish or abandon')
    await queue.discardComparison('comparison-1')
    const release = await queue.inhibit()
    await release()
  })

  it('prunes a completed comparison as a pair instead of orphaning a candidate', async () => {
    const [first, second] = pair('oldest')
    first!.comparison!.revealed = true
    second!.comparison!.revealed = true
    second!.comparison!.internalBlueprint = BLUEPRINT
    const entries: QueueDocument['entries'] = [
      { id: 'candidate-a', ...first!, status: 'done', createdAt: 0, updatedAt: 0 },
      { id: 'candidate-b', ...second!, status: 'pending', createdAt: 1, updatedAt: 1 },
      ...Array.from({ length: 63 }, (_, index) => ({
        id: `history-${index}`,
        request: request(`history ${index}`),
        status: 'done' as const,
        createdAt: index + 2,
        updatedAt: index + 2
      }))
    ]
    const engine = new FinishingEngine()
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: false, entries }),
      engine,
      sleep: () => new Promise((resolve) => setTimeout(resolve, 0))
    })
    await queue.init()
    await waitFor(() => engine.started)
    engine.finish()
    await waitFor(() => queue.snapshot().activeId === undefined)

    expect(queue.snapshot().entries.some((entry) => entry.comparison?.groupId === 'oldest')).toBe(
      false
    )
    expect(queue.snapshot().entries).toHaveLength(63)
  })
})
