// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync } from 'node:fs'
import { isSafeSegment, pointerPath, pluginDir } from './paths'
import { compareSemver } from './semver'

// current.txt is the active-version pointer. Rewritten atomically (write .tmp,
// rename) so a crash mid-write never leaves a half-written pointer — rollback
// is just flipping this file.

export function readPointer(id: string): string | null {
  try {
    return readFileSync(pointerPath(id), 'utf8').trim() || null
  } catch {
    return null
  }
}

export function writePointer(id: string, version: string): void {
  const path = pointerPath(id)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${version}\n`)
  renameSync(tmp, path)
}

// Installed version folders, ascending by semver.
export function installedVersions(id: string): string[] {
  const dir = pluginDir(id)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isSafeSegment(e.name))
    .map((e) => e.name)
    .sort(compareSemver)
}
