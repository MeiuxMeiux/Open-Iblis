// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const TRACK_ID = /^[0-9a-hjkmnp-tv-z]{26}$/

export interface StoredTrackPath {
  id: string
  filePath: string
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

// Deletion is allowed to clean a broken metadata row whose audio is already
// missing. Return null rather than touching a linked/escaping directory; only
// transient filesystem failures remain hard errors.
export async function trackDirectory(root: string, id: string): Promise<string | null> {
  if (!TRACK_ID.test(id)) return null
  const absoluteRoot = resolve(root)
  let rootPath: string
  try {
    rootPath = await realpath(absoluteRoot)
  } catch (error) {
    if (missing(error)) return null
    throw new Error('track storage is unavailable', { cause: error })
  }

  const directory = resolve(absoluteRoot, id)
  try {
    const [directoryPath, directoryInfo] = await Promise.all([
      realpath(directory),
      lstat(directory)
    ])
    if (
      directoryInfo.isSymbolicLink() ||
      !directoryInfo.isDirectory() ||
      !isWithin(rootPath, directoryPath)
    ) {
      return null
    }
    return directoryPath
  } catch (error) {
    if (missing(error)) return null
    throw new Error('track storage is unavailable', { cause: error })
  }
}

// Persisted library metadata is not filesystem authority. Resolve the id and
// audio path under the configured tracks root before every OS-facing action.
export async function trackStorage(
  root: string,
  track: StoredTrackPath
): Promise<{
  directory: string
  audioFile: string
}> {
  if (!TRACK_ID.test(track.id)) throw new Error('track identity is invalid')
  const absoluteRoot = resolve(root)
  const directory = resolve(absoluteRoot, track.id)
  const audioFile = resolve(track.filePath)
  const audioRelative = relative(directory, audioFile)
  if (
    !isWithin(absoluteRoot, directory) ||
    !audioRelative ||
    audioRelative !== 'audio.wav' ||
    audioRelative.startsWith('..') ||
    isAbsolute(audioRelative) ||
    dirname(audioRelative) !== '.'
  ) {
    throw new Error('track storage path is outside the library')
  }

  try {
    const directoryPath = await trackDirectory(absoluteRoot, track.id)
    if (!directoryPath) throw new Error('unsafe')
    const [audioPath, audioInfo] = await Promise.all([realpath(audioFile), lstat(audioFile)])
    if (audioInfo.isSymbolicLink() || !audioInfo.isFile() || dirname(audioPath) !== directoryPath) {
      throw new Error('unsafe')
    }
    return { directory: directoryPath, audioFile: audioPath }
  } catch {
    // Filesystem errors often contain the user's absolute profile path. Keep
    // the IPC boundary path-free while refusing missing, linked, or moved data.
    throw new Error('track storage is unavailable or outside the library')
  }
}
