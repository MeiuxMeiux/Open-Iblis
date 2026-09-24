// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Electron wiring for the community-trainings browser: verified index with
// offline cache and 15-minute refresh, managed downloads into the adapter
// library, and the yours/installed resolution the renderer renders.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import type { StyleIndexEntryView, StylesIndexView } from '../../../shared/styles'
import { downloadAdapterFile, importAdapterFile, listAdapters } from '../adapters'
import { installId } from '../install-id'
import { log } from '../logger'
import { heavyDataRoot } from '../storage'
import {
  originHashOf,
  verifyTrainingsIndex,
  type TrainingsIndex,
  type TrainingsIndexEntry
} from './trainings-index'
import { ignoreFailure } from '../ignore-failure'
import { trainingsIndexBase } from '../official-endpoints'

// The worker publishes the signed pair at trainings/index.json(.sig); the base
// comes from official-endpoints.ts.
const REFRESH_MS = 15 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000

let cached: { index: TrainingsIndex; fetchedAt: number; fromCache: boolean } | null = null

function cacheDir(): string {
  return join(heavyDataRoot(), 'cache', 'trainings-index')
}

async function fetchBytes(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    // The signed index lives on our GCS bucket, which serves objects without
    // redirects; refuse them so the pre-verification fetch can't be bounced.
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
    if (!response.ok) throw new Error(`HTTP ${response.status} for the trainings index`)
    return Buffer.from(await response.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

async function writeCache(bytes: Buffer, signature: string): Promise<void> {
  const dir = cacheDir()
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'index.json'), bytes)
  await writeFile(join(dir, 'index.json.sig'), signature, 'utf8')
}

// The cache stores exact signed bytes and is re-verified on every read —
// a tampered cache is just a missing cache.
async function readCache(): Promise<TrainingsIndex | null> {
  try {
    const dir = cacheDir()
    const [bytes, signature] = await Promise.all([
      readFile(join(dir, 'index.json')),
      readFile(join(dir, 'index.json.sig'), 'utf8')
    ])
    return verifyTrainingsIndex(bytes, signature)
  } catch {
    return null
  }
}

async function loadIndex(force = false): Promise<{ index: TrainingsIndex; fromCache: boolean }> {
  if (!force && cached && Date.now() - cached.fetchedAt < REFRESH_MS) {
    return { index: cached.index, fromCache: cached.fromCache }
  }
  try {
    const [bytes, signature] = await Promise.all([
      fetchBytes(`${trainingsIndexBase()}/index.json`),
      fetchBytes(`${trainingsIndexBase()}/index.json.sig`)
    ])
    const index = verifyTrainingsIndex(bytes, signature.toString('utf8'))
    await writeCache(bytes, signature.toString('utf8')).catch(ignoreFailure)
    cached = { index, fetchedAt: Date.now(), fromCache: false }
    return { index, fromCache: false }
  } catch (error) {
    log('warn', 'trainings index fetch failed, trying cache', { error: String(error) })
    const fallback = await readCache()
    if (!fallback) throw new Error('the community trainings index is unreachable', { cause: error })
    cached = { index: fallback, fetchedAt: Date.now(), fromCache: true }
    return { index: fallback, fromCache: true }
  }
}

function adapterFileOf(entry: TrainingsIndexEntry): { url: string; bytes: number; sha256: string } {
  const file = entry.files.find((candidate) => candidate.name.endsWith('.safetensors'))
  if (!file) throw new Error('this training publishes no adapter file')
  return { url: file.url, bytes: file.bytes, sha256: file.sha256 }
}

export async function stylesIndexView(force = false): Promise<StylesIndexView> {
  const { index, fromCache } = await loadIndex(force)
  const mine = originHashOf(installId())
  const library = await listAdapters().catch(() => [])
  const bySha = new Map(library.map((record) => [record.sha256, record.id]))
  const entries: StyleIndexEntryView[] = index.entries.map((entry) => {
    const adapter = entry.files.find((file) => file.name.endsWith('.safetensors'))
    const installedAdapterId = adapter ? bySha.get(adapter.sha256) : undefined
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      categories: entry.categories,
      tags: entry.tags,
      bytes: entry.bytes,
      downloadCount: entry.downloadCount,
      hasPreview: entry.previewUrl !== null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      yours: entry.originHash === mine,
      ...(installedAdapterId ? { installedAdapterId } : {})
    }
  })
  return { entries, fetchedAt: Date.now(), fromCache }
}

export async function downloadStyleFromIndex(
  id: string,
  onProgress: (received: number, total: number) => void
): Promise<string> {
  const { index } = await loadIndex()
  const entry = index.entries.find((candidate) => candidate.id === id)
  if (!entry) throw new Error('that training is no longer in the community index')
  const source = adapterFileOf(entry)
  const temp = await mkdtemp(join(heavyDataRoot(), 'style-download-'))
  try {
    const dest = join(temp, `${entry.name}.safetensors`)
    await downloadAdapterFile(source, dest, onProgress)
    const yours = entry.originHash === originHashOf(installId())
    const record = await importAdapterFile(dest, {
      displayName: entry.name,
      origin: yours ? 'yours' : 'downloaded',
      trainingId: entry.id,
      trainingVersion: entry.version,
      claimedBaseModel: 'ACE-Step 1.5',
      sourceUrl: source.url,
      acknowledgedAt: Date.now()
    })
    return record.id
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(ignoreFailure)
  }
}

export function broadcastStylesProgress(id: string, received: number, total: number): void {
  const percent = total > 0 ? Math.floor((received / total) * 100) : 0
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('styles:download-progress', { id, received, total, percent })
    }
  }
}
