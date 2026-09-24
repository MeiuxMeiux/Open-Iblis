// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { trackDirectory, trackStorage } from '../electron/main/library/paths'

const id = '01j00000000000000000000000'
let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'iblis-track-paths-'))
  await mkdir(join(root, id))
  await writeFile(join(root, id, 'audio.wav'), 'audio')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('library track storage authority', () => {
  it('accepts one real audio file directly inside its ULID directory', async () => {
    const canonicalRoot = await realpath(root)
    await expect(
      trackStorage(root, { id, filePath: resolve(root, id, 'audio.wav') })
    ).resolves.toEqual({
      directory: resolve(canonicalRoot, id),
      audioFile: resolve(canonicalRoot, id, 'audio.wav')
    })
  })

  it('rejects traversal identities and files outside the track directory', async () => {
    await expect(
      trackStorage(root, { id: '../escape', filePath: resolve(root, 'escape.wav') })
    ).rejects.toThrow('identity is invalid')
    await expect(
      trackStorage(root, { id, filePath: resolve(root, '..', 'escape.wav') })
    ).rejects.toThrow('outside the library')
    await expect(
      trackStorage(root, { id, filePath: resolve(root, id, 'nested/audio.wav') })
    ).rejects.toThrow('outside the library')
    await expect(
      trackStorage(root, { id, filePath: resolve(root, id, 'generation.json') })
    ).rejects.toThrow('outside the library')
    await expect(
      trackStorage(root, { id, filePath: resolve(root, id, 'audio.wav:secret') })
    ).rejects.toThrow('outside the library')
  })

  it('rejects a directory symlink or Windows junction that escapes the root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'iblis-track-outside-'))
    try {
      await writeFile(join(outside, 'audio.wav'), 'outside')
      await rm(join(root, id), { recursive: true })
      await symlink(outside, join(root, id), process.platform === 'win32' ? 'junction' : 'dir')

      await expect(
        trackStorage(root, { id, filePath: join(root, id, 'audio.wav') })
      ).rejects.toThrow('unavailable or outside')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects an audio-file symlink even when its target stays inside the root', async () => {
    const target = join(root, 'other.wav')
    await writeFile(target, 'other')
    await rm(join(root, id, 'audio.wav'))
    await symlink(target, join(root, id, 'audio.wav'), 'file')

    await expect(trackStorage(root, { id, filePath: join(root, id, 'audio.wav') })).rejects.toThrow(
      'unavailable or outside'
    )
  })

  it('authorizes safe row cleanup when audio or the whole track directory is missing', async () => {
    await rm(join(root, id, 'audio.wav'))
    await expect(trackDirectory(root, id)).resolves.toBe(await realpath(join(root, id)))
    await expect(trackStorage(root, { id, filePath: join(root, id, 'audio.wav') })).rejects.toThrow(
      'unavailable or outside'
    )

    await rm(join(root, id), { recursive: true })
    await expect(trackDirectory(root, id)).resolves.toBeNull()
    await expect(trackDirectory(root, '../escape')).resolves.toBeNull()
  })

  it('guards every OS-facing library action instead of trusting persisted paths', () => {
    const source = readFileSync(resolve(__dirname, '../electron/main/library/index.ts'), 'utf8')
    expect(source.match(/trackStorage\(tracksRoot\(\), track\)/g)?.length).toBeGreaterThanOrEqual(4)
    expect(source.match(/authorizedTrack\(track\)/g)?.length).toBeGreaterThanOrEqual(3)
    expect(source).toContain('return { ...track, filePath: audioFile }')
    expect(source).toContain('writeGenerationRecord(stored, evidence)')
    expect(source).toContain('ensureTrackAnalysis(stored)')
    expect(source).toContain('const directory = await trackDirectory(tracksRoot(), track.id)')
    expect(source).not.toContain('join(tracksRoot(), track.id)')
    expect(source).not.toContain('showItemInFolder(track.filePath)')
    expect(source).not.toContain('startDrag({ file: track.filePath')
    expect(source).not.toContain('respondWithLocalFile(request, track.filePath')
  })
})
