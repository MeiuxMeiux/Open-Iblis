// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  commitTrackDeletion,
  DELETION_COMMIT_MARKER,
  recoverStagedTrackDeletions,
  stagedTrackDirectory
} from '../electron/main/library/deletion'

const id = '01j00000000000000000000000'
let root: string
let directory: string
let staged: string

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'iblis-delete-'))
  directory = join(root, id)
  staged = stagedTrackDirectory(root, id)
  await mkdir(directory)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('failure-atomic library deletion', () => {
  it('restores media and skips disposal when metadata persistence fails', async () => {
    const discard = vi.fn(async () => true)
    await expect(
      commitTrackDeletion({
        directory,
        stagedDirectory: staged,
        removeRecord: async () => {
          expect(await exists(directory)).toBe(false)
          expect(await exists(staged)).toBe(true)
          throw new Error('disk unavailable')
        },
        discardStaged: discard
      })
    ).rejects.toThrow('disk unavailable')

    expect(await exists(directory)).toBe(true)
    expect(await exists(staged)).toBe(false)
    expect(discard).not.toHaveBeenCalled()
  })

  it('commits metadata before disposing the staged media', async () => {
    const events: string[] = []
    await commitTrackDeletion({
      directory,
      stagedDirectory: staged,
      removeRecord: async () => {
        events.push('metadata')
        expect(await exists(staged)).toBe(true)
      },
      discardStaged: async (path) => {
        events.push('media')
        await rm(path, { recursive: true })
        return true
      }
    })

    expect(events).toEqual(['metadata', 'media'])
    expect(await exists(directory)).toBe(false)
    expect(await exists(staged)).toBe(false)
  })

  it('removes a broken row without touching media when no safe directory exists', async () => {
    const removeRecord = vi.fn(async () => undefined)
    const discard = vi.fn(async () => true)
    await commitTrackDeletion({
      directory: null,
      removeRecord,
      discardStaged: discard
    })
    expect(removeRecord).toHaveBeenCalledOnce()
    expect(discard).not.toHaveBeenCalled()
  })

  it('reconciles pre-commit and post-commit tombstones after restart', async () => {
    await rm(directory, { recursive: true })
    await mkdir(staged)
    const restored = await recoverStagedTrackDeletions({
      root,
      hasRecord: async (candidate) => candidate === id,
      discardStaged: async () => false
    })
    expect(restored).toEqual({ restored: 1, discarded: 0, retained: 0 })
    expect(await exists(directory)).toBe(true)

    await rm(directory, { recursive: true })
    await mkdir(staged)
    await writeFile(join(staged, DELETION_COMMIT_MARKER), '')
    const discarded = await recoverStagedTrackDeletions({
      root,
      hasRecord: async () => false,
      discardStaged: async (path) => {
        await rm(path, { recursive: true })
        return true
      }
    })
    expect(discarded).toEqual({ restored: 0, discarded: 1, retained: 0 })
    expect(await exists(staged)).toBe(false)
  })

  it('retains an unmarked tombstone when missing metadata is inconclusive', async () => {
    await rm(directory, { recursive: true })
    await mkdir(staged)
    const discard = vi.fn(async () => true)
    const result = await recoverStagedTrackDeletions({
      root,
      hasRecord: async () => false,
      discardStaged: discard
    })

    expect(result).toEqual({ restored: 0, discarded: 0, retained: 1 })
    expect(discard).not.toHaveBeenCalled()
    expect(await exists(staged)).toBe(true)
  })

  it('ignores names that only resemble a deletion tombstone', async () => {
    const nearMiss = join(root, `x${id}ydeleting`)
    await mkdir(nearMiss)
    const hasRecord = vi.fn(async () => false)
    const discard = vi.fn(async () => true)

    expect(await recoverStagedTrackDeletions({ root, hasRecord, discardStaged: discard })).toEqual({
      restored: 0,
      discarded: 0,
      retained: 0
    })
    expect(hasRecord).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
    expect(await exists(nearMiss)).toBe(true)
  })

  it('retains an exact tombstone name when the entry is a link or junction', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'iblis-delete-outside-'))
    try {
      await writeFile(join(outside, DELETION_COMMIT_MARKER), '')
      await symlink(outside, staged, process.platform === 'win32' ? 'junction' : 'dir')
      const discard = vi.fn(async () => true)

      expect(
        await recoverStagedTrackDeletions({
          root,
          hasRecord: async () => false,
          discardStaged: discard
        })
      ).toEqual({ restored: 0, discarded: 0, retained: 1 })
      expect(discard).not.toHaveBeenCalled()
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
