// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_PENDING,
  createGenerationQueueScheduler
} from '../electron/main/generation-queue/scheduler'
import { createGenerationQueueStore } from '../electron/main/generation-queue/store'
import {
  FakeEngine,
  aceQueueRules,
  memoryStore,
  request,
  waitFor
} from './generation-queue-fixtures'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('generation queue store', () => {
  it('atomically persists and reloads a versioned document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iblis-queue-'))
    roots.push(root)
    const file = join(root, 'generation-queue.json')
    const store = createGenerationQueueStore(file, aceQueueRules)
    expect((await store.load()).document.entries).toEqual([])
    await store.replace({ version: 2, paused: true, pauseReason: 'test', entries: [] })
    expect(await store.load()).toMatchObject({
      corrupt: false,
      document: { version: 2, paused: true, pauseReason: 'test' }
    })
  })

  it('quarantines a corrupt document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iblis-queue-corrupt-'))
    roots.push(root)
    const file = join(root, 'generation-queue.json')
    await writeFile(file, '{broken', 'utf8')
    const loaded = await createGenerationQueueStore(file, aceQueueRules).load()
    expect(loaded.corrupt).toBe(true)
    expect(loaded.document.entries).toEqual([])
    expect(await readFile(`${file}.corrupt`, 'utf8')).toBe('{broken')
  })
})

describe('generation queue scheduler', () => {
  it('runs FIFO with maximum engine concurrency exactly one', async () => {
    const engine = new FakeEngine()
    let clock = 100
    const queue = createGenerationQueueScheduler({
      store: memoryStore(),
      engine,
      now: () => clock++,
      makeId: (() => {
        let id = 0
        return () => `entry-${++id}`
      })(),
      sleep: () => new Promise((resolve) => setTimeout(resolve, 0))
    })
    await queue.init()
    await queue.enqueue(request('one'))
    await queue.enqueue(request('two'))
    await queue.enqueue(request('three'))
    await waitFor(() => engine.starts.length === 1)
    engine.finish('job-1')
    await waitFor(() => engine.starts.length === 2)
    engine.finish('job-2')
    await waitFor(() => engine.starts.length === 3)
    engine.finish('job-3')
    await waitFor(() => queue.snapshot().entries.every((entry) => entry.status === 'done'))

    expect(engine.starts.map((value) => value.request.prompt)).toEqual(['one', 'two', 'three'])
    expect(engine.maximumActive).toBe(1)
  })

  it('persists the admitted target and hands the exact snapshot to execution', async () => {
    const engine = new FakeEngine()
    const target = {
      pluginId: 'mx.iblis.engine.example',
      version: '1.2.3',
      protocol: 2 as const,
      descriptorHash: 'a'.repeat(64)
    }
    const store = memoryStore()
    const queue = createGenerationQueueScheduler({ store, engine })
    await queue.init()
    const snapshot = await queue.enqueue(request('targeted'), target)
    expect(snapshot.entries[0]!.target).toEqual(target)
    await waitFor(() => engine.starts.length === 1)
    expect(engine.starts[0]!.target).toEqual(target)
    engine.finish('job-1')
    await waitFor(() => queue.snapshot().entries[0]!.status === 'done')
    // The persisted document carries the snapshot too.
    expect((await store.load()).document.entries[0]!.target).toEqual(target)
    // Duplication keeps the original admitted target.
    await queue.pause()
    const requeued = await queue.enqueue(request('second'), target)
    const duplicated = await queue.duplicate(requeued.entries.at(-1)!.id)
    expect(duplicated.entries.at(-1)!.target).toEqual(target)
  })

  it('rejects a rehydrated document with a malformed target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iblis-queue-target-'))
    roots.push(root)
    const file = join(root, 'generation-queue.json')
    const store = createGenerationQueueStore(file, aceQueueRules)
    const entry = {
      id: 'entry-1',
      request: request('bad target'),
      status: 'pending',
      createdAt: 1,
      updatedAt: 1,
      target: { pluginId: '', version: '1.0.0', protocol: 7 }
    }
    await writeFile(file, JSON.stringify({ version: 2, paused: false, entries: [entry] }))
    expect((await store.load()).corrupt).toBe(true)
  })

  it('supports pending edits, order, duplication, removal and the cap', async () => {
    const engine = new FakeEngine()
    let nextId = 0
    const queue = createGenerationQueueScheduler({
      store: memoryStore({ version: 2, paused: true, entries: [] }),
      engine,
      makeId: () => `entry-${++nextId}`
    })
    await queue.init()
    const first = await queue.enqueue(request('one'))
    const firstId = first.entries[0]!.id
    const second = await queue.enqueue(request('two'))
    const secondId = second.entries.find((entry) => entry.request.prompt === 'two')!.id
    await queue.edit(firstId, request('edited'))
    await queue.move(secondId, 0)
    await queue.duplicate(secondId)
    await queue.remove(firstId)
    expect(queue.snapshot().entries.map((entry) => entry.request.prompt)).toEqual(['two', 'two'])

    while (queue.snapshot().pendingCount < MAX_PENDING) {
      await queue.enqueue(request('cap'))
    }
    await expect(queue.enqueue(request('overflow'))).rejects.toThrow('pending cap')
  })

  it('pause-after-current gates the next take until resume', async () => {
    const engine = new FakeEngine()
    const queue = createGenerationQueueScheduler({ store: memoryStore(), engine })
    await queue.init()
    await queue.enqueue(request('one'))
    await queue.enqueue(request('two'))
    await waitFor(() => engine.starts.length === 1)
    await queue.pause()
    engine.finish('job-1')
    await waitFor(() => queue.snapshot().entries[0]?.status === 'done')
    expect(engine.starts).toHaveLength(1)
    await queue.resume()
    await waitFor(() => engine.starts.length === 2)
    await queue.cancel()
  })

  it('stop pauses, cancels and waits for settlement', async () => {
    const engine = new FakeEngine()
    const queue = createGenerationQueueScheduler({ store: memoryStore(), engine })
    await queue.init()
    await queue.enqueue(request('one'))
    await waitFor(() => engine.starts.length === 1)
    const stopped = await queue.cancel()
    expect(stopped.paused).toBe(true)
    expect(stopped.entries[0]?.status).toBe('cancelled')
  })

  it('holds pending work behind an engine mutation lease', async () => {
    const engine = new FakeEngine()
    const queue = createGenerationQueueScheduler({ store: memoryStore(), engine })
    await queue.init()
    const release = await queue.inhibit()
    await queue.enqueue(request('wait for update'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(engine.starts).toHaveLength(0)

    await release()
    await waitFor(() => engine.starts.length === 1)
    await queue.cancel()
  })

  it('makes request admission and engine mutation leases mutually exclusive', async () => {
    const queue = createGenerationQueueScheduler({ store: memoryStore(), engine: new FakeEngine() })
    await queue.init()
    const releaseAdmission = await queue.acquireAdmission()
    await expect(queue.inhibit()).rejects.toThrow('generation work is being admitted')
    await releaseAdmission()

    const releaseMutation = await queue.inhibit()
    await expect(queue.acquireAdmission()).rejects.toThrow('paused for an engine change')
    await releaseMutation()
  })

  it('failure pauses and startup recovery marks running work interrupted', async () => {
    const recovered = createGenerationQueueScheduler({
      store: memoryStore({
        version: 2,
        paused: false,
        entries: [
          {
            id: 'old',
            request: request('old'),
            status: 'running',
            createdAt: 1,
            updatedAt: 2,
            startedAt: 2,
            jobId: 'lost'
          }
        ]
      }),
      engine: new FakeEngine(),
      now: () => 10
    })
    const recoveredSnapshot = await recovered.init()
    expect(recoveredSnapshot).toMatchObject({ paused: true })
    expect(recoveredSnapshot.entries[0]).toMatchObject({ status: 'interrupted' })

    const engine = new FakeEngine()
    const queue = createGenerationQueueScheduler({ store: memoryStore(), engine })
    await queue.init()
    await queue.enqueue(request('bad'))
    await queue.enqueue(request('must wait'))
    await waitFor(() => engine.starts.length === 1)
    engine.finish('job-1', {
      status: 'error',
      progress: 0.5,
      error: { code: 'timeout', message: 'engine timed out' }
    })
    await waitFor(() => queue.snapshot().paused)
    expect(engine.starts).toHaveLength(1)
    expect(queue.snapshot().entries[0]?.status).toBe('failed')
  })
})

describe('generation queue integration boundaries', () => {
  it('exposes only typed queue mutation channels to the renderer', async () => {
    const ipc = await readFile(join(__dirname, '../electron/main/ipc-queue.ts'), 'utf8')
    const mainDir = join(__dirname, '../electron/main')
    const ipcFiles = (await readdir(mainDir)).filter((name) => /^ipc.*\.ts$/.test(name))
    const allIpc = (
      await Promise.all(ipcFiles.map((name) => readFile(join(mainDir, name), 'utf8')))
    ).join('\n')
    const preload = await readFile(join(__dirname, '../electron/preload/index.ts'), 'utf8')
    for (const channel of [
      'snapshot',
      'enqueue',
      'compare',
      'edit',
      'move',
      'duplicate',
      'remove',
      'pause',
      'resume',
      'cancel',
      'clear',
      'reveal',
      'discard-comparison'
    ]) {
      expect(ipc).toContain(`'queue:${channel}'`)
      expect(preload).toContain(`'queue:${channel}'`)
    }
    expect(allIpc).not.toContain("ipcMain.handle('engine:generate'")
    expect(preload).not.toContain("ipcRenderer.invoke('engine:generate'")
  })

  it('holds the queue interlock across engine lifecycle mutations', async () => {
    const source = await readFile(join(__dirname, '../electron/main/plugins/lifecycle.ts'), 'utf8')
    expect(source).toContain('release = await acquireEngineMutation()')
    const install = source.slice(source.indexOf('export async function installFromCatalog'))
    expect(install.indexOf('acquireEngineMutation()')).toBeLessThan(
      install.indexOf('supervisor.hotSwap')
    )
    const restart = source.slice(source.indexOf('export async function restartActiveSidecars'))
    expect(restart.indexOf('acquireEngineMutation()')).toBeLessThan(
      restart.indexOf('supervisor.hotSwap')
    )
    expect(restart.indexOf('supervisor.hotSwap')).toBeLessThan(restart.indexOf('release()'))
  })
})
