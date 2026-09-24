// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Persisted licensing state in userData/licensing.json — the training
// store's atomic temp+rename pattern, sized tiny. The product key is sealed
// (safeStorage) before it reaches this file; the store itself is dumb JSON.

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ignoreFailure } from '../ignore-failure'

export interface LicensingDocument {
  version: 1
  // 'enc:<base64>' via safeStorage, or 'plain:<key>' when the OS keystore
  // is unavailable. Null when keyless.
  keySealed: string | null
  maskedKey: string | null
  lease: string | null
  // Terminal server code that ended the license, else null.
  endedReason: string | null
  lastError: string | null
  // Wall-clock high-water mark for the rollback heuristic.
  lastWallClock: number
}

export interface LicensingStore {
  load(): Promise<LicensingDocument>
  replace(document: LicensingDocument): Promise<void>
}

const MAX_STORE_BYTES = 64 * 1024

export function emptyLicensingDocument(): LicensingDocument {
  return {
    version: 1,
    keySealed: null,
    maskedKey: null,
    lease: null,
    endedReason: null,
    lastError: null,
    lastWallClock: 0
  }
}

function valid(doc: unknown): doc is LicensingDocument {
  if (typeof doc !== 'object' || doc === null) return false
  const o = doc as Record<string, unknown>
  const nullableString = (v: unknown): boolean => v === null || typeof v === 'string'
  return (
    o.version === 1 &&
    nullableString(o.keySealed) &&
    nullableString(o.maskedKey) &&
    nullableString(o.lease) &&
    nullableString(o.endedReason) &&
    nullableString(o.lastError) &&
    typeof o.lastWallClock === 'number'
  )
}

export function createLicensingStore(file: string): LicensingStore {
  return {
    async load(): Promise<LicensingDocument> {
      let raw: string
      try {
        // Bounded read: the writer never exceeds the cap, so an oversized
        // file is tampered or corrupt and is quarantined, not parsed.
        if ((await stat(file)).size > MAX_STORE_BYTES) throw new RangeError('oversized')
        raw = await readFile(file, 'utf8')
      } catch (error) {
        if (!(error instanceof RangeError)) return emptyLicensingDocument()
        raw = ''
      }
      try {
        const parsed: unknown = JSON.parse(raw)
        if (valid(parsed)) return parsed
      } catch {
        /* falls through to quarantine */
      }
      // A downgraded or corrupt document is quarantined, never fatal.
      await rename(file, `${file}.corrupt`).catch(ignoreFailure)
      return emptyLicensingDocument()
    },

    async replace(document: LicensingDocument): Promise<void> {
      const serialized = JSON.stringify(document, null, 1)
      if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
        throw new Error('licensing store exceeds the size cap')
      }
      await mkdir(dirname(file), { recursive: true })
      const temp = `${file}.${randomUUID()}.tmp`
      try {
        // Owner-only: the document holds the sealed key (or, where no OS
        // keystore exists, the plain key) and the lease credential.
        await writeFile(temp, serialized, { encoding: 'utf8', mode: 0o600 })
        await rename(temp, file)
      } catch (error) {
        await rm(temp, { force: true }).catch(ignoreFailure)
        throw error
      }
    }
  }
}
