// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProcessorJobStateV1 } from '@iblis/plugin-sdk'
import { createProcessorSidecarClient } from '../electron/main/processors/client'
import {
  createProcessorScheduler,
  type ProcessorProvider
} from '../electron/main/processors/scheduler'
import { createProcessorStore, type ProcessorStore } from '../electron/main/processors/store'

const roots: string[] = []
const stores: ProcessorStore[] = []
// A scheduler's last save can still be in flight when a test's condition
// holds; Windows refuses to delete a folder while a file in it is open.
afterEach(async () => {
  await Promise.all(stores.splice(0).map((target) => target.settled()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const provider: ProcessorProvider = {
  id: 'mx.iblis.processor.test',
  version: '1.0.0',
  capabilities: ['bpm-detect', 'key-detect']
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; !condition() && attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  expect(condition()).toBe(true)
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'iblis-processors-'))
  roots.push(root)
  const target = createProcessorStore(join(root, 'processor-jobs.json'))
  stores.push(target)
  await target.load()
  await target.setDefault('bpm-detect', provider.id)
  await target.setDefault('key-detect', provider.id)
  return target
}

describe('processor sidecar client', () => {
  it('rejects malformed results before they reach the durable host', async () => {
    const client = createProcessorSidecarClient(async () =>
      response({
        protocolVersion: 1,
        jobId: 'p1',
        status: 'done',
        progress: 1,
        results: [{ capability: 'bpm-detect', value: { bpm: Infinity } }]
      })
    )
    await expect(client.state('p1')).rejects.toThrow('invalid results')
  })

  it('attaches one request body and handles idempotent cancellation responses', async () => {
    const paths: string[] = []
    const client = createProcessorSidecarClient(async (path, init) => {
      paths.push(`${init?.method ?? 'GET'} ${path}`)
      if (path === '/v1/process')
        return response({ protocolVersion: 1, jobId: 'p1', accepted: true })
      return response({
        protocolVersion: 1,
        jobId: 'p1',
        cancelled: false,
        reason: 'already-terminal'
      })
    })
    await client.start({
      protocolVersion: 1,
      jobId: 'p1',
      input: {
        trackId: 'track-1',
        audioPath: 'C:/not-renderer-visible.wav',
        sourceSha256: 'a'.repeat(64)
      },
      capabilities: ['bpm-detect']
    })
    await client.cancel('p1')
    expect(paths).toEqual(['POST /v1/process', 'POST /v1/jobs/p1/cancel'])
  })
})

describe('processor scheduler', () => {
  it('stores only source-matched, normalized results with provider provenance', async () => {
    const durable = await store()
    const starts: string[] = []
    const done: ProcessorJobStateV1 = {
      protocolVersion: 1,
      jobId: 'job-1',
      status: 'done',
      progress: 1,
      results: [
        {
          capability: 'bpm-detect',
          value: { schemaVersion: 1, bpm: 128, confidence: null, alternatives: [] }
        },
        {
          capability: 'key-detect',
          value: {
            schemaVersion: 1,
            pitchClass: 'F#',
            mode: 'minor',
            confidence: 0.7,
            alternatives: []
          }
        }
      ]
    }
    const scheduler = createProcessorScheduler({
      store: durable,
      provider: (id) => (id === provider.id ? provider : null),
      input: async () => ({ id: 'track-1', audioPath: '/safe/audio.wav', format: 'wav' }),
      client: () => ({
        start: async (request) => {
          starts.push(request.jobId)
        },
        state: async (jobId) => ({ ...done, jobId }),
        cancel: async () => {}
      }),
      mayRun: async () => true,
      hash: async () => 'b'.repeat(64),
      makeId: () => 'job-1',
      sleep: async () => {}
    })
    await scheduler.initialize()
    await scheduler.enqueue('track-1')
    await waitFor(
      () =>
        scheduler.results('track-1').length === 2 &&
        durable.jobs().every((job) => job.status === 'done')
    )
    expect(starts).toEqual(['job-1'])
    expect(scheduler.results('track-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'bpm-detect',
          pluginId: provider.id,
          sourceSha256: 'b'.repeat(64)
        }),
        expect.objectContaining({
          capability: 'key-detect',
          value: expect.objectContaining({ pitchClass: 'F#' }) as unknown
        })
      ])
    )
  })

  it('bounds retry, then lets an explicit retry reset a failed job', async () => {
    const durable = await store()
    let starts = 0
    let succeed = false
    const scheduler = createProcessorScheduler({
      store: durable,
      provider: () => provider,
      input: async () => ({ id: 'track-1', audioPath: '/safe/audio.wav', format: 'wav' }),
      client: () => ({
        start: async () => {
          starts++
        },
        state: async (jobId) =>
          succeed
            ? {
                protocolVersion: 1,
                jobId,
                status: 'done',
                progress: 1,
                results: [
                  {
                    capability: 'bpm-detect',
                    value: { schemaVersion: 1, bpm: 100, confidence: null, alternatives: [] }
                  }
                ]
              }
            : {
                protocolVersion: 1,
                jobId,
                status: 'error',
                progress: 0,
                error: { code: 'busy', message: 'busy', retryable: true }
              },
        cancel: async () => {}
      }),
      mayRun: async () => true,
      hash: async () => 'c'.repeat(64),
      sleep: async () => {}
    })
    await scheduler.initialize()
    await scheduler.enqueue('track-1', ['bpm-detect'])
    await waitFor(() => durable.jobs()[0]?.status === 'error')
    expect(starts).toBe(3)
    succeed = true
    await scheduler.retry('track-1', 'bpm-detect')
    await waitFor(
      () =>
        scheduler.results('track-1').length === 1 &&
        durable.jobs().every((job) => job.status === 'done')
    )
    expect(starts).toBe(4)
    expect(scheduler.results('track-1')[0]).toMatchObject({
      capability: 'bpm-detect',
      sourceSha256: 'c'.repeat(64)
    })
  })

  it('persists only a selected compatible provider and exposes path-free job state', async () => {
    const durable = await store()
    const scheduler = createProcessorScheduler({
      store: durable,
      provider: (id) => (id === provider.id ? provider : null),
      input: async () => ({ id: 'track-1', audioPath: '/safe/audio.wav', format: 'wav' }),
      client: () => ({
        start: async () => {},
        state: async () => ({}) as ProcessorJobStateV1,
        cancel: async () => {}
      }),
      mayRun: async () => false,
      hash: async () => 'f'.repeat(64)
    })
    await scheduler.initialize()
    await expect(scheduler.setDefault('bpm-detect', 'missing.provider')).rejects.toThrow(
      'selected processor is unavailable'
    )
    await scheduler.setDefault('bpm-detect', provider.id)
    await scheduler.enqueue('track-1', ['bpm-detect'])

    expect(scheduler.settings().defaults).toMatchObject({ 'bpm-detect': provider.id })
    expect(scheduler.jobs('track-1')).toEqual([
      expect.objectContaining({
        trackId: 'track-1',
        status: 'queued',
        capabilities: ['bpm-detect']
      })
    ])
    expect(JSON.stringify(scheduler.jobs('track-1'))).not.toContain('/safe/audio.wav')
  })

  it('requires a version-and-revision-bound acknowledgement for private evaluation', async () => {
    const durable = await store()
    const restricted: ProcessorProvider = {
      ...provider,
      evaluation: {
        status: 'evaluation-only',
        distribution: 'private-lab',
        codeLicense: 'LicenseRef-Review',
        dependencyLicenses: [],
        termsUrl: 'https://example.test/terms',
        noticePath: 'NOTICE.txt',
        upstreamRevision: 'reviewed-sha',
        acknowledgement: 'Private evaluation only.'
      }
    }
    const scheduler = createProcessorScheduler({
      store: durable,
      provider: () => restricted,
      input: async () => null,
      client: () => ({
        start: async () => {},
        state: async () => ({}) as ProcessorJobStateV1,
        cancel: async () => {}
      }),
      mayRun: async () => false
    })
    await scheduler.initialize()
    await expect(scheduler.setDefault('bpm-detect', restricted.id)).rejects.toThrow(
      'processor acknowledgement is required'
    )
    await scheduler.acknowledge(restricted.id)
    await scheduler.setDefault('bpm-detect', restricted.id)
    expect(durable.settings().acknowledgements[restricted.id]).toMatchObject({
      version: restricted.version,
      upstreamRevision: 'reviewed-sha'
    })
  })

  it('queues explicitly chosen providers without reading or changing active defaults', async () => {
    const durable = await store()
    const second: ProcessorProvider = {
      ...provider,
      id: 'mx.iblis.processor.second',
      version: '2.0.0',
      name: 'Second detector',
      legalStatus: 'commercial-candidate'
    }
    const ids = ['benchmark-1', 'job-1', 'job-2']
    const scheduler = createProcessorScheduler({
      store: durable,
      provider: (id) => (id === provider.id ? provider : id === second.id ? second : null),
      input: async () => ({ id: 'track-1', audioPath: '/safe/audio.wav', format: 'wav' }),
      client: () => ({
        start: async () => {},
        state: async (jobId) => ({
          protocolVersion: 1,
          jobId,
          status: 'done',
          progress: 1,
          results: [
            {
              capability: 'bpm-detect',
              value: { schemaVersion: 1, bpm: 128, confidence: 0.8, alternatives: [] }
            },
            {
              capability: 'key-detect',
              value: {
                schemaVersion: 1,
                pitchClass: 'C',
                mode: 'major',
                confidence: null,
                alternatives: []
              }
            }
          ]
        }),
        cancel: async () => {}
      }),
      mayRun: async () => true,
      hash: async () => 'e'.repeat(64),
      makeId: () => ids.shift()!,
      sleep: async () => {}
    })
    await scheduler.initialize()
    const before = scheduler.settings().defaults
    await expect(scheduler.benchmark('track-1', [provider.id])).rejects.toThrow(
      'at least two different installed providers'
    )
    const benchmark = await scheduler.benchmark('track-1', [provider.id, second.id])
    expect(benchmark).toMatchObject({
      id: 'benchmark-1',
      sourceSha256: 'e'.repeat(64),
      providers: [
        expect.objectContaining({ id: provider.id, legalStatus: 'unreviewed' }),
        expect.objectContaining({ id: second.id, legalStatus: 'commercial-candidate' })
      ]
    })
    expect(scheduler.settings().defaults).toEqual(before)
    await waitFor(
      () =>
        scheduler.benchmarks()[0]?.results.length === 4 &&
        scheduler.benchmarks()[0]?.jobs.every((job) => job.status === 'done') === true
    )
    const completed = scheduler.benchmarks()[0]!
    expect(completed.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ benchmarkId: 'benchmark-1', pluginId: provider.id }),
        expect.objectContaining({ benchmarkId: 'benchmark-1', pluginId: second.id })
      ])
    )
    expect(completed.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ peakMemoryBytes: null })])
    )
    expect(JSON.stringify(completed)).not.toContain('/safe/audio.wav')
  })

  it('requeues an interrupted job on startup and holds work while higher-priority work runs', async () => {
    const durable = await store()
    await durable.saveJob({
      id: 'interrupted',
      trackId: 'track-1',
      capabilities: ['bpm-detect'],
      pluginId: provider.id,
      pluginVersion: provider.version,
      status: 'running',
      attempts: 1,
      progress: 0.2,
      sourceSha256: 'd'.repeat(64),
      config: {},
      configHash: 'e'.repeat(64),
      createdAt: 1,
      updatedAt: 2
    })
    let allowed = false
    let started = 0
    const scheduler = createProcessorScheduler({
      store: durable,
      provider: () => provider,
      input: async () => ({ id: 'track-1', audioPath: '/safe/audio.wav', format: 'wav' }),
      client: () => ({
        start: async () => {
          started++
        },
        state: async (jobId) => ({ protocolVersion: 1, jobId, status: 'cancelled', progress: 0 }),
        cancel: async () => {}
      }),
      mayRun: async () => allowed,
      hash: async () => 'd'.repeat(64),
      sleep: async () => {}
    })
    await scheduler.initialize()
    expect(durable.jobs()[0]).toMatchObject({ status: 'queued', error: { code: 'interrupted' } })
    expect(started).toBe(0)
    allowed = true
    await scheduler.enqueue('track-1', [])
    await new Promise((resolve) => setTimeout(resolve, 550))
    expect(started).toBe(1)
    await waitFor(() => durable.jobs()[0]?.status === 'cancelled')
  })
})
