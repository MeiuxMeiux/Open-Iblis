// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { dialog, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { basename, join } from 'node:path'
import type {
  AdapterInstallProgress,
  AdapterImportDetails,
  ImportedAdapterFormat,
  ImportedAdapterRecord
} from '../../../shared/adapters'
import { createAdapterLibrary, type AdapterLibrary } from './library'
import { downloadableAdapterOffer } from './offers'
import { MAX_ADAPTER_BYTES } from './types'
import { heavyDataRoot } from '../storage'
import { ignoreFailure } from '../ignore-failure'

let store: AdapterLibrary | undefined

function library(): AdapterLibrary {
  store ??= createAdapterLibrary()
  return store
}

async function downloadOffer(
  source: { url: string; bytes: number; sha256: string },
  destination: string,
  onProgress?: (received: number, total: number) => void
): Promise<number> {
  if (source.bytes < 1 || source.bytes > MAX_ADAPTER_BYTES) {
    throw new Error('adapter offer has an invalid or oversized file')
  }
  // Redirects followed on purpose (like plugin asset downloads): the adapter
  // file is vendor/GCS-hosted and fully SHA-256-pinned to its reviewed record
  // below, so a redirect can only relocate the bytes, never substitute them.
  const response = await fetch(source.url, { redirect: 'follow' })
  if (!response.ok || !response.body)
    throw new Error(`adapter download failed (HTTP ${response.status})`)
  const declared = Number.parseInt(response.headers.get('content-length') ?? '0', 10)
  if (Number.isFinite(declared) && declared > 0 && declared !== source.bytes) {
    throw new Error('adapter download size does not match its reviewed record')
  }
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_ADAPTER_BYTES) {
    throw new Error('adapter download has an invalid or oversized length')
  }
  const output = createWriteStream(destination, { flags: 'wx' })
  const hash = createHash('sha256')
  let received = 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength
      if (received > source.bytes || received > MAX_ADAPTER_BYTES) {
        throw new Error('adapter download exceeds its reviewed size')
      }
      hash.update(chunk)
      if (!output.write(Buffer.from(chunk))) await once(output, 'drain')
      onProgress?.(received, source.bytes)
    }
    await new Promise<void>((resolve, reject) => {
      output.once('error', reject)
      output.end(resolve)
    })
    if (received !== source.bytes || hash.digest('hex') !== source.sha256) {
      throw new Error('adapter download does not match its reviewed hash')
    }
    return received
  } catch (error) {
    output.destroy()
    throw error
  }
}

export async function importAdapterFromDialog(
  owner: BrowserWindow | null,
  format: ImportedAdapterFormat,
  details: AdapterImportDetails,
  acknowledged: boolean
): Promise<ImportedAdapterRecord | null> {
  if (!acknowledged) throw new Error('style disclosure must be acknowledged')
  const pickerOptions: OpenDialogOptions = {
    title: format === 'peft' ? 'Choose PEFT adapter folder' : 'Choose Safetensors adapter',
    buttonLabel: 'Import adapter',
    properties: [format === 'peft' ? 'openDirectory' : 'openFile'],
    ...(format === 'safetensors'
      ? { filters: [{ name: 'Safetensors', extensions: ['safetensors'] }] }
      : {})
  }
  const picked = owner
    ? await dialog.showOpenDialog(owner, pickerOptions)
    : await dialog.showOpenDialog(pickerOptions)
  const [sourcePath] = picked.filePaths
  if (picked.canceled || picked.filePaths.length !== 1 || !sourcePath) return null
  return library().import(sourcePath, { ...details, acknowledgedAt: Date.now() })
}

export function listAdapters(): Promise<ImportedAdapterRecord[]> {
  return library().list()
}

// Programmatic import for main-owned flows (training pull-down): same
// validation and content-addressed storage as the dialog path, no dialog.
export function importAdapterFile(
  sourcePath: string,
  details: AdapterImportDetails & { acknowledgedAt: number }
): Promise<ImportedAdapterRecord> {
  return library().import(sourcePath, details)
}

// Streaming, hash-verified download into a fresh destination file. Exposed
// for the training pull-down; identical guarantees to offer installs.
export function downloadAdapterFile(
  source: { url: string; bytes: number; sha256: string },
  destination: string,
  onProgress?: (received: number, total: number) => void
): Promise<number> {
  return downloadOffer(source, destination, onProgress)
}

export async function installAdapterOffer(
  offerId: string,
  acknowledged: boolean,
  report: (progress: AdapterInstallProgress) => void
): Promise<ImportedAdapterRecord | null> {
  const offer = downloadableAdapterOffer(offerId)
  if (!acknowledged) throw new Error('style disclosure must be acknowledged')

  const staging = await mkdtemp(join(heavyDataRoot(), 'adapter-download-'))
  try {
    const target = offer.format === 'peft' ? join(staging, 'peft') : staging
    if (offer.format === 'peft') await mkdir(target)
    let completed = 0
    const destinations = new Set<string>()
    for (const source of offer.download.files) {
      const name = basename(source.path)
      const weights = name.endsWith('.safetensors')
      const config = name === 'adapter_config.json'
      const supported = offer.format === 'peft' ? config || weights : weights
      if (!supported) {
        throw new Error('adapter offer contains an unsupported file')
      }
      const targetName =
        offer.format === 'peft'
          ? weights
            ? 'adapter_model.safetensors'
            : name
          : 'adapter.safetensors'
      if (destinations.has(targetName)) throw new Error('adapter offer contains duplicate files')
      destinations.add(targetName)
      const destination = join(target, targetName)
      const bytes = await downloadOffer(source, destination, (received) => {
        report({ offerId, received: completed + received, total: offer.bytes })
      })
      completed += bytes
    }
    const sourcePath = offer.format === 'peft' ? target : join(target, 'adapter.safetensors')
    return await library().import(sourcePath, {
      displayName: offer.name,
      sourceOfferId: offer.id,
      sourceUrl: offer.sourceUrl,
      sourceRevision: offer.sourceRevision,
      claimedLicense: offer.claimedLicense,
      terms: offer.terms,
      claimedBaseModel: offer.claimedBaseModel,
      acknowledgedAt: Date.now()
    })
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(ignoreFailure)
  }
}

export async function removeAdapter(id: string): Promise<void> {
  await library().remove(id)
}

export async function revealAdapter(id: string): Promise<void> {
  shell.showItemInFolder(await library().revealLocation(id))
}

export function copyAdapterForCompatibilityProof(
  id: string,
  target: string
): Promise<ImportedAdapterRecord> {
  return library().copyForCompatibilityProof(id, target)
}
