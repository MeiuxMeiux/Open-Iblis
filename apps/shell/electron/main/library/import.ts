// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// One-time sweep of pre-library generations: before alpha.7, finished tracks
// landed as <jobId>.wav directly in the tracks root. Move each into the
// tracks/<ulid>/audio.wav layout and register it, so nothing Jack generated
// while soak-testing is lost. Idempotent by construction: a swept file no
// longer sits at the root, so the next run finds nothing.

import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LibraryStore } from './store'
import { tryParseWav } from '../media/wav'

export async function importOrphans(tracksRoot: string, store: LibraryStore): Promise<number> {
  let names: string[]
  try {
    names = await readdir(tracksRoot)
  } catch {
    return 0 // no tracks dir yet — nothing ever generated
  }

  let imported = 0
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.wav')) continue
    const orphan = join(tracksRoot, name)
    const info = await stat(orphan).catch(() => null)
    if (!info?.isFile()) continue

    const audio = tryParseWav(await readFile(orphan))
    if (!audio) continue // leave malformed bytes untouched for manual recovery

    const id = store.mintId()
    const dir = join(tracksRoot, id)
    const dest = join(dir, 'audio.wav')
    await mkdir(dir, { recursive: true })
    await rename(orphan, dest)
    await store.add({
      id,
      createdAt: Math.round(info.mtimeMs), // keep the generation date, not the import date
      name: `Imported ${name.replace(/\.wav$/i, '').slice(0, 8)}`,
      prompt: '',
      filePath: dest,
      format: 'wav',
      durationSec: audio.durationSec,
      audio,
      tags: ['imported']
    })
    imported++
  }
  return imported
}
