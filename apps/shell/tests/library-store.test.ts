// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createLibraryStore,
  deriveTrackName,
  makeUlid,
  type LibraryStore
} from '../electron/main/library/store'
import { insertFolder } from '../electron/main/library/folders'

let dir: string
let file: string
let clock: number
let store: LibraryStore

async function readDocument(path: string): Promise<{ tracks: { id: string }[] }> {
  return JSON.parse(await readFile(path, 'utf8')) as { tracks: { id: string }[] }
}

function makeStore(): LibraryStore {
  let counter = 0
  return createLibraryStore({
    file,
    now: () => clock,
    // Deterministic-but-distinct randomness so minted ids never collide.
    randomBytes: (n) => {
      counter++
      return new Uint8Array(n).map((_, i) => (i + counter) % 32)
    }
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'iblis-lib-'))
  file = join(dir, 'library.json')
  clock = 1_700_000_000_000
  store = makeStore()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('deriveTrackName', () => {
  it('uses the first prompt line plus the seed', () => {
    expect(deriveTrackName('neurofunk, dark\nsecond line', 8841)).toBe('neurofunk, dark — 8841')
  })

  it('truncates long prompts and handles missing seed/prompt', () => {
    const long = 'x'.repeat(80)
    expect(deriveTrackName(long).length).toBeLessThanOrEqual(48)
    expect(deriveTrackName('')).toBe('Untitled')
    expect(deriveTrackName('', 7)).toBe('Untitled — 7')
  })
})

describe('makeUlid', () => {
  it('is 26 lowercase crockford chars, time-ordered', () => {
    const a = makeUlid(1000, new Uint8Array(16))
    const b = makeUlid(2000, new Uint8Array(16))
    expect(a).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/)
    expect(b > a).toBe(true)
  })
})

describe('LibraryStore', () => {
  it('adds a track with derived name and lists newest first', async () => {
    await store.add({ prompt: 'first', filePath: '/t/a.wav', format: 'wav', seed: 1 })
    clock += 1000
    await store.add({ prompt: 'second', filePath: '/t/b.wav', format: 'wav' })

    const list = await store.list()
    expect(list.map((t) => t.prompt)).toEqual(['second', 'first'])
    expect(list[1]?.name).toBe('first — 1')
    expect(list[0]?.rating).toBe(0)
  })

  it('persists across store instances (atomic JSON on disk)', async () => {
    const added = await store.add({
      prompt: 'keep me',
      filePath: '/t/x.wav',
      format: 'wav',
      requestedDurationSec: 30,
      durationSec: 30.5,
      audio: {
        containerBytes: 11_712_044,
        formatTag: 3,
        codecTag: 3,
        codec: 'ieee-float',
        sampleRateHz: 48000,
        channels: 2,
        bitsPerSample: 32,
        blockAlignBytes: 8,
        byteRateBytesPerSec: 384000,
        dataOffset: 44,
        dataBytes: 11_712_000,
        frames: 1_464_000,
        durationSec: 30.5
      },
      preset: 'balanced',
      seed: 42,
      enginePluginId: 'mx.iblis.engine.acestep',
      enginePluginVersion: '0.1.3',
      generationJobId: 'host-job-42'
    })

    const reopened = makeStore()
    const back = await reopened.get(added.id)
    expect(back).toEqual(added)
  })

  it('renames in place without touching the file path', async () => {
    const t = await store.add({ prompt: 'p', filePath: '/t/x.wav', format: 'wav' })
    clock += 5
    const renamed = await store.rename(t.id, '  Sick Drop  ')
    expect(renamed.name).toBe('Sick Drop')
    expect(renamed.filePath).toBe('/t/x.wav')
    expect(renamed.updatedAt).toBeGreaterThan(renamed.createdAt)

    // Whitespace-only rename is a no-op, not a blanking.
    const still = await store.rename(t.id, '   ')
    expect(still.name).toBe('Sick Drop')
  })

  it('rates and removes', async () => {
    const t = await store.add({ prompt: 'p', filePath: '/t/x.wav', format: 'wav' })
    expect((await store.rate(t.id, 1)).rating).toBe(1)
    expect((await store.rate(t.id, -1)).rating).toBe(-1)

    const gone = await store.remove(t.id)
    expect(gone?.id).toBe(t.id)
    expect(await store.get(t.id)).toBeUndefined()
    expect(await store.remove(t.id)).toBeUndefined()
  })

  it('rejects mutations of unknown tracks', async () => {
    await expect(store.rename('nope', 'x')).rejects.toThrow('unknown track')
    await expect(store.rate('nope', 1)).rejects.toThrow('unknown track')
  })

  it('quarantines a corrupt document instead of crashing forever', async () => {
    await writeFile(file, '{ not json', 'utf8')
    const fresh = makeStore()
    expect(await fresh.list()).toEqual([])
    await fresh.add({ prompt: 'p', filePath: '/t/x.wav', format: 'wav' })
    expect((await readDocument(file)).tracks).toHaveLength(1)
    expect(await readFile(`${file}.corrupt`, 'utf8')).toBe('{ not json')
  })

  it('fails closed on a transient read error and retries without replacing valid data', async () => {
    const existing = await store.add({ prompt: 'keep me', filePath: '/t/x.wav', format: 'wav' })
    let reads = 0
    let writes = 0
    const recovering = createLibraryStore({
      file,
      now: () => clock,
      randomBytes: (n) => new Uint8Array(n),
      async readDocument() {
        reads++
        if (reads === 1) {
          throw Object.assign(new Error('temporary library read failure'), { code: 'EIO' })
        }
        return readFile(file, 'utf8')
      },
      async writeDocument(serialized) {
        writes++
        await writeFile(file, serialized, 'utf8')
      }
    })

    await expect(recovering.createFolder('Must not commit')).rejects.toThrow(
      'temporary library read failure'
    )
    expect(writes).toBe(0)
    expect((await readDocument(file)).tracks[0]?.id).toBe(existing.id)
    await expect(readFile(`${file}.corrupt`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await recovering.createFolder('Recovered')
    expect(writes).toBe(1)
    expect((await makeStore().get(existing.id))?.id).toBe(existing.id)
  })

  it('persists a track config for remix fidelity', async () => {
    const t = await store.add({
      prompt: 'p',
      filePath: '/t/x.wav',
      format: 'wav',
      config: { negativePrompt: 'pop', bpm: 174, rewritePrompt: false }
    })
    const fresh = makeStore()
    expect((await fresh.get(t.id))?.config).toEqual({
      negativePrompt: 'pop',
      bpm: 174,
      rewritePrompt: false
    })
  })
})

describe('library folders', () => {
  it('creates, renames, files tracks, and deletes without moving audio', async () => {
    const track = await store.add({ prompt: 'file me', filePath: '/t/original.wav', format: 'wav' })
    const folder = await store.createFolder('  Works in progress  ')
    expect(folder.name).toBe('Works in progress')
    expect((await store.listFolders()).map((item) => item.name)).toEqual(['Works in progress'])

    clock += 5
    const filed = await store.moveToFolder(track.id, folder.id)
    expect(filed.folderId).toBe(folder.id)
    expect(filed.filePath).toBe('/t/original.wav')
    expect(filed.updatedAt).toBe(clock)

    expect((await store.renameFolder(folder.id, 'Drafts')).name).toBe('Drafts')
    await expect(store.createFolder('drafts')).rejects.toThrow('already exists')
    await store.removeFolder(folder.id)

    const reopened = makeStore()
    expect(await reopened.listFolders()).toEqual([])
    const restored = await reopened.get(track.id)
    expect(restored?.folderId).toBeUndefined()
    expect(restored?.filePath).toBe('/t/original.wav')
  })

  it('validates names and rejects unknown folder assignments', async () => {
    const track = await store.add({ prompt: 'p', filePath: '/t/x.wav', format: 'wav' })
    await expect(store.createFolder('   ')).rejects.toThrow('folder name is required')
    await expect(store.createFolder('x'.repeat(81))).rejects.toThrow('80 characters or fewer')
    await expect(store.createFolder('All tracks')).rejects.toThrow('reserved by the Library')
    await expect(store.createFolder('no FOLDER')).rejects.toThrow('reserved by the Library')
    await expect(store.moveToFolder(track.id, 'missing')).rejects.toThrow('unknown folder')
    await expect(store.renameFolder('missing', 'Name')).rejects.toThrow('unknown folder')
    await expect(store.removeFolder('missing')).rejects.toThrow('unknown folder')
  })

  it('repairs malformed legacy folder metadata before exposing it', async () => {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        tracks: [
          {
            id: 'track',
            createdAt: 1,
            updatedAt: 1,
            name: 'Track',
            prompt: 'p',
            filePath: '/t/x.wav',
            format: 'wav',
            rating: 0,
            folderId: 'missing',
            tags: []
          }
        ],
        folders: [
          {
            id: 'kept',
            parentId: 'missing',
            name: 'Kept',
            createdAt: 1,
            sortOrder: 0
          },
          { id: 'reserved-legacy', name: 'No folder', createdAt: 2, sortOrder: 2 },
          { id: 'blank', name: ' ', createdAt: 1, sortOrder: 1 },
          { id: 'bad-order', name: 'Bad', createdAt: 1, sortOrder: -1 },
          null
        ],
        prompts: []
      }),
      'utf8'
    )

    const fresh = makeStore()
    expect(await fresh.listFolders()).toEqual([
      { id: 'kept', name: 'Kept', createdAt: 1, sortOrder: 0 },
      { id: 'reserved-legacy', name: 'No folder', createdAt: 2, sortOrder: 1 }
    ])
    expect((await fresh.get('track'))?.folderId).toBeUndefined()
  })

  it('serializes concurrent first-load mutations and atomic writes', async () => {
    const fresh = makeStore()
    const [folder] = await Promise.all([
      fresh.createFolder('Concurrent'),
      fresh.recordPromptUse('remember me'),
      fresh.add({ prompt: 'one', filePath: '/t/one.wav', format: 'wav' }),
      fresh.add({ prompt: 'two', filePath: '/t/two.wav', format: 'wav' })
    ])

    const reopened = makeStore()
    expect((await reopened.listFolders()).map((item) => item.id)).toEqual([folder.id])
    expect(await reopened.listPrompts()).toHaveLength(1)
    expect(await reopened.list()).toHaveLength(2)
  })

  it('rolls back memory when persistence fails instead of leaking a ghost mutation', async () => {
    let failNext = true
    const guarded = createLibraryStore({
      file,
      now: () => clock,
      randomBytes: (n) => new Uint8Array(n),
      async writeDocument(serialized) {
        if (failNext) {
          failNext = false
          throw new Error('disk unavailable')
        }
        await writeFile(file, serialized, 'utf8')
      }
    })

    await expect(
      guarded.add({ prompt: 'must roll back', filePath: '/t/ghost.wav', format: 'wav' })
    ).rejects.toThrow('disk unavailable')
    expect(await guarded.list()).toEqual([])

    await guarded.add({ prompt: 'committed', filePath: '/t/real.wav', format: 'wav' })
    expect((await makeStore().list()).map((track) => track.prompt)).toEqual(['committed'])
  })

  it('returns stable snapshots from overlapping mutations of one record', async () => {
    const track = await store.add({ prompt: 'p', filePath: '/t/x.wav', format: 'wav' })
    const first = store.rename(track.id, 'First')
    const second = store.rename(track.id, 'Second')
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult.name).toBe('First')
    expect(secondResult.name).toBe('Second')
    expect((await store.get(track.id))?.name).toBe('Second')
  })

  it('normalizes legacy sort orders before exposing or extending them', async () => {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        tracks: [],
        folders: [
          {
            id: 'legacy',
            name: 'Legacy',
            createdAt: 1,
            sortOrder: Number.MAX_SAFE_INTEGER
          }
        ],
        prompts: []
      }),
      'utf8'
    )
    const fresh = makeStore()
    expect((await fresh.listFolders()).map((folder) => folder.sortOrder)).toEqual([0])
    await fresh.createFolder('New')
    expect((await makeStore().listFolders()).map((folder) => folder.sortOrder)).toEqual([0, 1])
  })

  it('appends after order gaps without rewriting existing folders', async () => {
    const first = await store.createFolder('First')
    const second = await store.createFolder('Second')
    const third = await store.createFolder('Third')
    const fourth = await store.createFolder('Fourth')
    await store.removeFolder(first.id)
    await store.removeFolder(second.id)

    expect((await store.listFolders()).map((folder) => folder.sortOrder)).toEqual([2, 3])
    const added = await store.createFolder('Added')
    expect(added.sortOrder).toBe(4)
    expect((await store.listFolders()).map((folder) => [folder.id, folder.sortOrder])).toEqual([
      [third.id, 2],
      [fourth.id, 3],
      [added.id, 4]
    ])
  })

  it('compacts before appending only when the next order would overflow', () => {
    const folders = [
      { id: 'first', name: 'First', createdAt: 1, sortOrder: 7 },
      { id: 'last', name: 'Last', createdAt: 2, sortOrder: Number.MAX_SAFE_INTEGER }
    ]

    const added = insertFolder(folders, 'Added', 'added', 3)
    expect(added.sortOrder).toBe(2)
    expect(folders.map((folder) => folder.sortOrder)).toEqual([0, 1, 2])
  })

  it('returns the complete organizer state after deleting a parent folder', async () => {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        tracks: [
          {
            id: 'track',
            createdAt: 1,
            updatedAt: 1,
            name: 'Track',
            prompt: 'p',
            filePath: '/t/x.wav',
            format: 'wav',
            rating: 0,
            folderId: 'parent',
            tags: []
          }
        ],
        folders: [
          { id: 'parent', name: 'Parent', createdAt: 1, sortOrder: 0 },
          { id: 'child', parentId: 'parent', name: 'Child', createdAt: 2, sortOrder: 1 }
        ],
        prompts: []
      }),
      'utf8'
    )
    const fresh = makeStore()
    const result = await fresh.removeFolder('parent')
    expect(result.removed.id).toBe('parent')
    expect(result.folders).toEqual([{ id: 'child', name: 'Child', createdAt: 2, sortOrder: 1 }])
    expect(result.tracks[0]?.folderId).toBeUndefined()
  })
})

describe('prompt history', () => {
  it('dedups on normalized first line and bumps use counts', async () => {
    const a = await store.recordPromptUse('Dark Neurofunk, 174 bpm')
    clock += 1000
    const b = await store.recordPromptUse('  dark neurofunk, 174 BPM  \nextra line')
    expect(b.id).toBe(a.id)
    expect(b.useCount).toBe(2)
    expect(b.lastUsedAt).toBe(clock)
    expect(b.firstUsedAt).toBe(clock - 1000)
    expect(await store.listPrompts()).toHaveLength(1)
  })

  it('lists starred first, then most recent', async () => {
    const old = await store.recordPromptUse('old starred')
    clock += 1000
    await store.recordPromptUse('middle')
    clock += 1000
    await store.recordPromptUse('newest')
    await store.starPrompt(old.id, true)

    const list = await store.listPrompts()
    expect(list.map((p) => p.text)).toEqual(['old starred', 'newest', 'middle'])
  })

  it('removes single entries and clear-all spares starred', async () => {
    const a = await store.recordPromptUse('keep me starred')
    const b = await store.recordPromptUse('delete me')
    await store.recordPromptUse('cleared')
    await store.starPrompt(a.id, true)

    await store.removePrompt(b.id)
    expect((await store.listPrompts()).map((p) => p.text)).toEqual(['keep me starred', 'cleared'])

    expect(await store.clearPrompts()).toBe(1)
    const left = await store.listPrompts()
    expect(left.map((p) => p.text)).toEqual(['keep me starred'])
    // Clearing again removes nothing and survives a reload.
    expect(await store.clearPrompts()).toBe(0)
    expect((await makeStore().listPrompts()).map((p) => p.text)).toEqual(['keep me starred'])
  })

  it('tolerates an alpha.7 document without prompt records', async () => {
    await writeFile(file, JSON.stringify({ version: 1, tracks: [] }), 'utf8')
    const fresh = makeStore()
    expect(await fresh.listPrompts()).toEqual([])
    await fresh.recordPromptUse('first')
    expect(await fresh.listPrompts()).toHaveLength(1)
  })
})
