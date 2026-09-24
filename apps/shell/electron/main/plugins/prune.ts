// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { rmSync } from 'node:fs'
import { versionDir } from './paths'
import { readPointer, installedVersions } from './pointer'
import { log } from '../logger'

// Keep disk bounded after an install. Retain the active version plus the most
// recent non-active versions up to `keep` total (so a rollback still has a
// target), and delete everything older. The active version is never deleted —
// pruning must never break the currently-running sidecar.
export function pruneVersions(id: string, keep = 2): string[] {
  const active = readPointer(id)
  const versions = installedVersions(id) // ascending semver
  const nonActive = versions.filter((v) => v !== active)
  const keepCount = Math.max(0, keep - 1) // active takes one slot
  const keepNonActive = new Set(nonActive.slice(nonActive.length - keepCount))

  const removed: string[] = []
  for (const v of versions) {
    if (v === active || keepNonActive.has(v)) continue
    rmSync(versionDir(id, v), { recursive: true, force: true })
    removed.push(v)
  }
  if (removed.length) log('info', 'pruned old plugin versions', { id, keep, removed })
  return removed
}
