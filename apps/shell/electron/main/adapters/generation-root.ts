// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The generation adapter root: a main-owned mirror of the adapter library
// the engine can actually load from. Each library record hardlinks into one
// flat folder under a stable registry name (slug + hash prefix), and every
// engine launch appends --adapters <root> so the live /props registry lists
// exactly what the library holds. The registry name resolves back to the
// library record (and its origin/training provenance) via nameForRecord.

import { link, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PluginManifest } from '@iblis/plugin-sdk'
import type { ImportedAdapterRecord } from '../../../shared/adapters'
import { styleRegistryName } from '../../../shared/styles'
import { adaptersRoot } from './library'
import { ignoreFailure } from '../ignore-failure'

function generationAdapterRoot(): string {
  return join(adaptersRoot(), 'engine-root')
}

// The registry name the engine exposes for a record: filename stem of the
// mirrored file. Stable per record (content hash disambiguates duplicates).
export function nameForRecord(record: ImportedAdapterRecord): string {
  return styleRegistryName(record.displayName, record.sha256)
}

function weightsFileOf(record: ImportedAdapterRecord): string | null {
  const file = record.files.find((candidate) => candidate.name.endsWith('.safetensors'))
  return file ? file.name : null
}

// Rebuild the mirror to match the library exactly. Hardlinks share bytes
// with the library items (same filesystem); stale names are removed.
export async function syncGenerationAdapterRoot(
  records: ImportedAdapterRecord[],
  itemsDir: string = join(adaptersRoot(), 'items'),
  root: string = generationAdapterRoot()
): Promise<string> {
  await mkdir(root, { recursive: true })
  const wanted = new Map<string, string>()
  for (const record of records) {
    const weights = weightsFileOf(record)
    // PEFT directories stay out of the flat root until the engine proves a
    // directory-adapter contract; single-file safetensors mirror cleanly.
    if (!weights || record.format !== 'safetensors') continue
    wanted.set(`${nameForRecord(record)}.safetensors`, join(itemsDir, record.id, weights))
  }
  const existing = await readdir(root).catch(() => [])
  for (const name of existing) {
    if (!wanted.has(name)) await rm(join(root, name), { force: true }).catch(ignoreFailure)
  }
  for (const [name, source] of wanted) {
    const target = join(root, name)
    try {
      await link(source, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return root
}

// Applied at every engine launch. Never mutates the signed manifest on disk;
// only the spawn-time argument list, exactly like the thread-cap env.
export function withGenerationAdapterRoot(
  manifest: PluginManifest,
  root: string = generationAdapterRoot()
): PluginManifest {
  if (manifest.kind !== 'engine' || !manifest.executable) return manifest
  const args = manifest.executable.args ?? []
  if (args.includes('--adapters')) return manifest
  return {
    ...manifest,
    executable: { ...manifest.executable, args: [...args, '--adapters', root] }
  }
}
