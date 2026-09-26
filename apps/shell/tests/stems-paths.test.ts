// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readStemSets, stemFilePath, stemSetDirectory } from '../electron/main/stems/promote'

const TRACK = '01j9zzzzzzzzzzzzzzzzzzzzzz'
let dir: string

function record(id: string, trackId = TRACK, file = 'vocals.wav') {
  return JSON.stringify({
    schema: 1,
    id,
    trackId,
    createdAt: 1,
    files: [{ role: 'stem.vocals', file }]
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'iblis-stem-paths-'))
  await mkdir(join(dir, 'stems', 'set1'), { recursive: true })
  await writeFile(join(dir, 'stems', 'set1', 'set.v1.json'), record('set1'))
  await writeFile(join(dir, 'stems', 'set1', 'vocals.wav'), 'RIFF')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('stem path resolution', () => {
  it('resolves a declared stem of a promoted set', async () => {
    expect(await stemFilePath(dir, TRACK, 'set1', 'stem.vocals')).toBe(
      join(dir, 'stems', 'set1', 'vocals.wav')
    )
    expect(await stemSetDirectory(dir, TRACK, 'set1')).toBe(join(dir, 'stems', 'set1'))
  })

  it('refuses traversal, unknown roles, and undeclared stems', async () => {
    expect(await stemFilePath(dir, TRACK, '../set1', 'stem.vocals')).toBeNull()
    expect(await stemFilePath(dir, TRACK, 'set1', 'stem.kazoo' as never)).toBeNull()
    expect(await stemFilePath(dir, TRACK, 'set1', 'stem.drums')).toBeNull()
    expect(await stemSetDirectory(dir, TRACK, '..')).toBeNull()
  })

  it('refuses a record that belongs to another track or names a path', async () => {
    await writeFile(
      join(dir, 'stems', 'set1', 'set.v1.json'),
      record('set1', '01j9yyyyyyyyyyyyyyyyyyyyyy')
    )
    expect(await readStemSets(dir, TRACK)).toEqual([])
    await writeFile(
      join(dir, 'stems', 'set1', 'set.v1.json'),
      record('set1', TRACK, '../../audio.wav')
    )
    expect(await readStemSets(dir, TRACK)).toEqual([])
  })

  it('refuses a stem file that is a symbolic link', async () => {
    await rm(join(dir, 'stems', 'set1', 'vocals.wav'))
    await writeFile(join(dir, 'secret.wav'), 'x')
    await symlink(join(dir, 'secret.wav'), join(dir, 'stems', 'set1', 'vocals.wav'))
    expect(await stemFilePath(dir, TRACK, 'set1', 'stem.vocals')).toBeNull()
  })

  it('ignores the staging folder and linked set folders', async () => {
    await mkdir(join(dir, 'stems', '.staging', 'job9'), { recursive: true })
    await mkdir(join(dir, 'elsewhere'))
    await writeFile(join(dir, 'elsewhere', 'set.v1.json'), record('link1'))
    await symlink(join(dir, 'elsewhere'), join(dir, 'stems', 'link1'))
    expect((await readStemSets(dir, TRACK)).map((s) => s.id)).toEqual(['set1'])
  })
})
