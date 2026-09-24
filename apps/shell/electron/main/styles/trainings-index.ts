// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Verified community-trainings discovery index (docs/training/04). Fetches
// index.json + index.json.sig from the public trainings prefix, verifies the
// Ed25519 signature over the exact bytes with the same committed key that
// signs the catalog, validates the shape, and keeps the last verified copy
// for offline use. Pure logic is injected-transport for tests.

import { createHash } from 'node:crypto'
import { verifyCatalogSignature } from '../catalog/verify'
import type { TrainingCategory } from '../../../shared/training'

interface TrainingsIndexFile {
  name: string
  bytes: number
  sha256: string
  url: string
}

export interface TrainingsIndexEntry {
  id: string
  name: string
  version: number
  categories: TrainingCategory[]
  tags: string[]
  bytes: number
  sha256: string
  files: TrainingsIndexFile[]
  previewUrl: string | null
  createdAt: string
  updatedAt: string
  downloadCount: number
  minAppVersion: string | null
  originHash: string
}

export interface TrainingsIndex {
  schema: 1
  generatedAt: string
  entries: TrainingsIndexEntry[]
}

const SHA256 = /^[a-f0-9]{64}$/
const ID = /^tr-[a-f0-9]{16}$/
const PUBLIC_URL_PREFIX = 'https://storage.googleapis.com/iblis-dist/trainings/'
const MAX_INDEX_BYTES = 4 * 1024 * 1024
const CATEGORIES = ['texture', 'groove']

function validFile(value: unknown): value is TrainingsIndexFile {
  // Signed but still parsed JSON: fields may be missing or null.
  const file = value as Partial<TrainingsIndexFile> | null
  return (
    !!file &&
    typeof file.name === 'string' &&
    /^[a-z0-9_.-]+$/.test(file.name) &&
    typeof file.bytes === 'number' &&
    Number.isSafeInteger(file.bytes) &&
    file.bytes > 0 &&
    SHA256.test(file.sha256 ?? '') &&
    typeof file.url === 'string' &&
    file.url.startsWith(PUBLIC_URL_PREFIX)
  )
}

function validEntry(value: unknown): value is TrainingsIndexEntry {
  const entry = value as Partial<TrainingsIndexEntry> | null
  return (
    !!entry &&
    ID.test(entry.id ?? '') &&
    typeof entry.name === 'string' &&
    typeof entry.version === 'number' &&
    Number.isSafeInteger(entry.version) &&
    entry.version > 0 &&
    Array.isArray(entry.categories) &&
    entry.categories.every((c) => CATEGORIES.includes(c)) &&
    Array.isArray(entry.tags) &&
    entry.tags.every((t) => typeof t === 'string' && t.length <= 48) &&
    Number.isSafeInteger(entry.bytes) &&
    SHA256.test(entry.sha256 ?? '') &&
    Array.isArray(entry.files) &&
    entry.files.length > 0 &&
    entry.files.every(validFile) &&
    (entry.previewUrl === null || typeof entry.previewUrl === 'string') &&
    typeof entry.createdAt === 'string' &&
    typeof entry.updatedAt === 'string' &&
    Number.isSafeInteger(entry.downloadCount) &&
    (entry.minAppVersion === null || typeof entry.minAppVersion === 'string') &&
    SHA256.test(entry.originHash ?? '')
  )
}

// Parse + validate exact signed bytes into a typed index. Throws on any
// structural surprise — a valid signature over an invalid document is still
// invalid.
export function parseTrainingsIndex(bytes: Buffer): TrainingsIndex {
  if (bytes.byteLength > MAX_INDEX_BYTES) throw new Error('trainings index is oversized')
  const parsed = JSON.parse(bytes.toString('utf8')) as {
    schema?: unknown
    generatedAt?: unknown
    trainings?: unknown
  }
  if (parsed.schema !== 1 || typeof parsed.generatedAt !== 'string') {
    throw new Error('trainings index has an unknown schema')
  }
  const list = Array.isArray(parsed.trainings) ? parsed.trainings : null
  if (!list?.every(validEntry)) throw new Error('trainings index entries are invalid')
  return { schema: 1, generatedAt: parsed.generatedAt, entries: list }
}

export function verifyTrainingsIndex(
  bytes: Buffer,
  signatureBase64: string,
  pubKeyPem?: string
): TrainingsIndex {
  if (!verifyCatalogSignature(bytes, signatureBase64.trim(), pubKeyPem)) {
    throw new Error('trainings index signature verification failed')
  }
  return parseTrainingsIndex(bytes)
}

export function originHashOf(installId: string): string {
  return createHash('sha256').update(installId).digest('hex')
}
