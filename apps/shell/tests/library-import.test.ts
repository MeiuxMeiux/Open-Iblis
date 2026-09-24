// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLibraryStore, type LibraryStore } from '../electron/main/library/store'
import { importOrphans } from '../electron/main/library/import'
import { makeWav } from './fixtures/wav'

let root: string
let store: LibraryStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'iblis-import-'))
  store = createLibraryStore({ file: join(root, 'library.json') })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('importOrphans', () => {
  it('moves loose <jobId>.wav files into tracks/<ulid>/audio.wav rows', async () => {
    const wav = makeWav({ frames: 16000 })
    await writeFile(join(root, 'aaaa-bbbb-cccc.wav'), wav)
    // Preserve the generation date: mtime should become createdAt.
    const when = new Date('2026-07-10T12:00:00Z')
    await utimes(join(root, 'aaaa-bbbb-cccc.wav'), when, when)

    expect(await importOrphans(root, store)).toBe(1)

    const [track] = await store.list()
    expect(track?.name).toBe('Imported aaaa-bbb')
    expect(track?.prompt).toBe('')
    expect(track?.tags).toContain('imported')
    expect(track?.durationSec).toBe(2)
    expect(track?.audio).toMatchObject({ sampleRateHz: 8000, frames: 16000 })
    expect(track?.createdAt).toBe(when.getTime())
    expect(track?.filePath).toBe(join(root, track!.id, 'audio.wav'))

    // The orphan is gone from the root; only the db and the track dir remain.
    const names = await readdir(root)
    expect(names.some((n) => n.endsWith('.wav'))).toBe(false)
  })

  it('is idempotent and ignores non-wav entries and track dirs', async () => {
    await writeFile(join(root, 'one.wav'), makeWav({ frames: 8000 }))
    await writeFile(join(root, 'notes.txt'), 'not audio')
    await mkdir(join(root, 'somedir'))

    expect(await importOrphans(root, store)).toBe(1)
    expect(await importOrphans(root, store)).toBe(0)
    expect((await store.list()).length).toBe(1)
  })

  it('returns 0 when the tracks root does not exist yet', async () => {
    expect(await importOrphans(join(root, 'missing'), store)).toBe(0)
  })

  it('leaves malformed WAV bytes untouched for manual recovery', async () => {
    await writeFile(join(root, 'broken.wav'), 'not audio')
    expect(await importOrphans(root, store)).toBe(0)
    expect(await readdir(root)).toContain('broken.wav')
    expect(await store.list()).toEqual([])
  })
})
