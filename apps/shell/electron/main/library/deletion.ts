// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { lstat, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ignoreFailure } from '../ignore-failure'

const TRACK_ID = '[0-9a-hjkmnp-tv-z]{26}'
const STAGED_NAME = new RegExp(`^\\.(${TRACK_ID})\\.deleting$`)
const VALID_TRACK_ID = new RegExp(`^${TRACK_ID}$`)
export const DELETION_COMMIT_MARKER = '.metadata-removed'

export function stagedTrackDirectory(root: string, id: string): string {
  if (!VALID_TRACK_ID.test(id)) throw new Error('track identity is invalid')
  return join(root, `.${id}.deleting`)
}

export async function commitTrackDeletion(options: {
  directory: string | null
  stagedDirectory?: string
  removeRecord: () => Promise<void>
  discardStaged: (path: string) => Promise<boolean>
  move?: (from: string, to: string) => Promise<void>
  markCommitted?: (stagedDirectory: string) => Promise<void>
}): Promise<void> {
  if (!options.directory) {
    await options.removeRecord()
    return
  }
  if (!options.stagedDirectory) throw new Error('staged track directory is required')
  const move = options.move ?? rename
  await move(options.directory, options.stagedDirectory)
  try {
    await options.removeRecord()
  } catch (error) {
    // The metadata commit failed, so put the media back before surfacing the
    // failure. Atomic store writes ensure recovery sees either the old row or
    // no row after a process crash.
    await move(options.stagedDirectory, options.directory)
    throw error
  }
  const markCommitted =
    options.markCommitted ??
    ((stagedDirectory: string) =>
      writeFile(join(stagedDirectory, DELETION_COMMIT_MARKER), '', { flag: 'wx' }))
  // The marker lets startup distinguish a committed delete from a corrupt
  // library document that merely appears to have no row. Failure to mark is
  // safe: recovery retains the tombstone instead of guessing.
  await markCommitted(options.stagedDirectory).catch(ignoreFailure)
  // A failed OS cleanup leaves a hidden tombstone for startup reconciliation;
  // the successfully removed row must not reappear as a broken track.
  await options.discardStaged(options.stagedDirectory)
}

export interface DeletionRecovery {
  restored: number
  discarded: number
  retained: number
}

export async function recoverStagedTrackDeletions(options: {
  root: string
  hasRecord: (id: string) => Promise<boolean>
  discardStaged: (path: string) => Promise<boolean>
  move?: (from: string, to: string) => Promise<void>
}): Promise<DeletionRecovery> {
  let names: string[]
  try {
    names = await readdir(options.root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { restored: 0, discarded: 0, retained: 0 }
    }
    throw error
  }

  const result: DeletionRecovery = { restored: 0, discarded: 0, retained: 0 }
  const move = options.move ?? rename
  for (const name of names) {
    const id = STAGED_NAME.exec(name)?.[1]
    if (!id) continue
    const staged = join(options.root, name)
    const stagedInfo = await lstat(staged).catch(() => null)
    if (!stagedInfo?.isDirectory() || stagedInfo.isSymbolicLink()) {
      result.retained++
      continue
    }
    if (await options.hasRecord(id)) {
      try {
        await move(staged, join(options.root, id))
        result.restored++
      } catch {
        // Never overwrite a live directory. Keep the tombstone for manual or
        // next-start recovery and leave the valid metadata row untouched.
        result.retained++
      }
      continue
    }

    const committed = await lstat(join(staged, DELETION_COMMIT_MARKER)).then(
      (info) => info.isFile() && !info.isSymbolicLink(),
      () => false
    )
    if (!committed) {
      // A missing row is inconclusive when the library document was corrupt.
      // Preserve the only media copy unless the commit marker proves removal.
      result.retained++
    } else if (await options.discardStaged(staged)) {
      result.discarded++
    } else {
      result.retained++
    }
  }
  return result
}
