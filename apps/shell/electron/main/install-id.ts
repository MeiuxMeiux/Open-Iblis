// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// A stable, anonymous per-install identity shared by licensing and the
// community-trainings client; servers only ever see or publish its hash.

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let cachedInstallId: string | null = null

// Plain file under userData, created on first use.
export function installId(): string {
  if (cachedInstallId) return cachedInstallId
  const file = join(app.getPath('userData'), 'install-id')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (/^[A-Za-z0-9._-]{1,64}$/.test(existing)) {
      cachedInstallId = existing
      return existing
    }
  } catch {
    /* first run */
  }
  const fresh = randomUUID()
  writeFileSync(file, `${fresh}\n`, 'utf8')
  cachedInstallId = fresh
  return fresh
}
