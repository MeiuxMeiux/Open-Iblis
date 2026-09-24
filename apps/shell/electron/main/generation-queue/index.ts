// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow } from 'electron'
import { randomInt, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import type { QueueComparisonVariant, QueueSnapshot } from '../../../shared/generation-queue'
import { engineProvider } from '../engine'
import { onSidecarLifecycle } from '../sidecar/supervisor'
import { log } from '../logger'
import { buildBlindComparison } from './comparison'
import { createGenerationQueueScheduler, type QueueScheduler } from './scheduler'
import { createGenerationQueueStore } from './store'
import { errorMessage } from '../error-message'

let singleton: QueueScheduler | null = null
let ready: Promise<QueueScheduler> | null = null
let releaseRuntime!: () => void
const runtimeReady = new Promise<void>((resolve) => (releaseRuntime = resolve))

// Rejections are untyped: prefer a `message` field, else stringify the value.
function describeError(error: unknown): string {
  return errorMessage(error)
}

function scheduler(): QueueScheduler {
  if (singleton) return singleton
  const provider = engineProvider()
  singleton = createGenerationQueueScheduler({
    store: createGenerationQueueStore(
      join(app.getPath('userData'), 'generation-queue.json'),
      provider
    ),
    engine: {
      start(request, blueprint, target) {
        const result = provider.startGenerate(request, blueprint, target)
        if (!result.ok) throw new Error(result.error)
        return result.data
      },
      state(jobId) {
        const result = provider.jobState(jobId)
        return result.ok ? result.data : undefined
      },
      settled: (jobId) => provider.settled(jobId),
      cancel: (jobId) => provider.cancelDirect(jobId),
      blueprint: (jobId) => provider.blueprint(jobId)
    }
  })
  singleton.subscribe((snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('queue:snapshot', snapshot)
    }
  })
  onSidecarLifecycle((event) => {
    if (!singleton?.isActive() || event.id !== provider.activeEngineId()) return
    void singleton.pause().catch((error: unknown) => {
      log('error', 'failed to pause queue after sidecar exit', {
        id: event.id,
        error: describeError(error)
      })
    })
    void provider
      .abortActive('sidecar_lost', 'The engine sidecar exited during generation.')
      .catch((error: unknown) => {
        log('error', 'failed to abort generation after sidecar exit', {
          id: event.id,
          error: describeError(error)
        })
      })
  })
  return singleton
}

async function queue(): Promise<QueueScheduler> {
  ready ??= runtimeReady.then(() => scheduler().init()).then(() => scheduler())
  return ready
}

function validate(request: GenerateRequest): void {
  const error = engineProvider().requestError(request)
  if (error) throw new Error(error)
}

export async function initializeGenerationQueue(): Promise<void> {
  await queue()
}

export function markGenerationRuntimeReady(): void {
  releaseRuntime()
}

export async function queueSnapshot(): Promise<QueueSnapshot> {
  return (await queue()).snapshot()
}

// Push the current snapshot immediately, then every change. Resolves after
// queue init, so callers subscribe once the runtime is ready.
export async function subscribeQueueSnapshots(
  listener: (snapshot: QueueSnapshot) => void
): Promise<() => void> {
  const target = await queue()
  listener(target.snapshot())
  return target.subscribe(listener)
}

export async function enqueueGeneration(request: GenerateRequest): Promise<QueueSnapshot> {
  validate(request)
  const target = await queue()
  const release = await target.acquireAdmission()
  try {
    const provider = engineProvider()
    return await target.enqueue(
      await provider.resolveQueuedRequest(request),
      provider.currentTarget() ?? undefined
    )
  } finally {
    await release()
  }
}

export async function editGeneration(id: string, request: GenerateRequest): Promise<QueueSnapshot> {
  validate(request)
  const target = await queue()
  const release = await target.acquireAdmission()
  try {
    const provider = engineProvider()
    return await target.edit(
      id,
      await provider.resolveQueuedRequest(request),
      provider.currentTarget() ?? undefined
    )
  } finally {
    await release()
  }
}

// The variant arrives over IPC from the renderer, so it is validated as
// untrusted input before any field is read.
function isComparisonVariant(value: unknown): value is QueueComparisonVariant {
  if (!value) return false
  const variant = value as Partial<Record<keyof QueueComparisonVariant, unknown>>
  return (
    typeof variant.profileId === 'string' &&
    variant.profileId.length > 0 &&
    variant.profileId.length <= 128 &&
    (variant.steps === undefined || Number.isFinite(variant.steps)) &&
    (variant.guidance === undefined || Number.isFinite(variant.guidance))
  )
}

export async function enqueueGenerationComparison(
  request: GenerateRequest,
  variant: unknown
): Promise<QueueSnapshot> {
  validate(request)
  if (!isComparisonVariant(variant)) throw new Error('comparison variant is invalid')
  const target = await queue()
  const release = await target.acquireAdmission()
  try {
    const provider = engineProvider()
    const { control, candidate } = await provider.resolveComparisonPair(request, variant)
    const admitted = provider.currentTarget() ?? undefined
    return await target.enqueueBatch(
      buildBlindComparison(control, candidate, randomInt(2) === 0, randomUUID()).map((insert) => ({
        ...insert,
        ...(admitted ? { target: admitted } : {})
      }))
    )
  } finally {
    await release()
  }
}

export async function revealGenerationComparison(groupId: string): Promise<QueueSnapshot> {
  if (typeof groupId !== 'string' || groupId.length === 0 || groupId.length > 128) {
    throw new Error('comparison group is invalid')
  }
  return (await queue()).revealComparison(groupId)
}

export async function discardGenerationComparison(groupId: string): Promise<QueueSnapshot> {
  if (typeof groupId !== 'string' || groupId.length === 0 || groupId.length > 128) {
    throw new Error('comparison group is invalid')
  }
  return (await queue()).discardComparison(groupId)
}

export async function moveGeneration(id: string, toIndex: number): Promise<QueueSnapshot> {
  return (await queue()).move(id, toIndex)
}

export async function duplicateGeneration(id: string): Promise<QueueSnapshot> {
  return (await queue()).duplicate(id)
}

export async function removeGeneration(id: string): Promise<QueueSnapshot> {
  return (await queue()).remove(id)
}

export async function pauseGenerationQueue(): Promise<QueueSnapshot> {
  return (await queue()).pause()
}

export async function resumeGenerationQueue(): Promise<QueueSnapshot> {
  return (await queue()).resume()
}

export async function cancelCurrentGeneration(): Promise<QueueSnapshot> {
  return (await queue()).cancel()
}

export async function clearGenerationHistory(): Promise<QueueSnapshot> {
  return (await queue()).clear()
}

// Hold this lease across an engine install, rollback, removal, or hot-swap.
// The scheduler rejects the lease if a take is already live and will not start
// pending work until the caller releases it, closing the check-then-mutate race.
export async function acquireEngineMutation(): Promise<() => Promise<void>> {
  return (await queue()).inhibit()
}

// Diagnostics compatibility work must not race queued takes: unlike an engine
// install, it deliberately replaces the live sidecar twice to compare empty
// and populated adapter roots.
export async function acquireEmptyQueueEngineMutation(): Promise<() => Promise<void>> {
  return (await queue()).inhibitWhenQueueEmpty()
}

export async function shutdownGenerationQueue(): Promise<void> {
  if (singleton) await singleton.shutdown()
}
