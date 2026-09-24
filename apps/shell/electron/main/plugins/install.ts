// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  mkdirSync,
  writeFileSync,
  rmSync,
  renameSync,
  existsSync,
  chmodSync,
  readdirSync,
  statSync,
  linkSync,
  createReadStream
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, normalize, isAbsolute, sep } from 'node:path'
import extractZip from 'extract-zip'
import type { PluginAsset, PluginManifest } from '@iblis/plugin-sdk'
import type { InstallProgress } from '../../../shared/contract'
import { versionDir, pluginDir } from './paths'
import { downloadAsset } from './download'
import { writePointer } from './pointer'
import { assertSafeZipEntry } from './zip-guard'
import { log } from '../logger'

// Resolve `rel` under `dir` and refuse anything that escapes the folder.
// The SDK validator already rejects a traversing `asset.path`, but the
// installer is the last gate before bytes hit disk (or a sibling is
// hardlinked), so it re-checks rather than trusting the manifest.
function within(dir: string, rel: string): string {
  if (isAbsolute(rel)) throw new Error(`unsafe asset path: ${rel}`)
  const full = normalize(join(dir, rel))
  if (full !== dir && !full.startsWith(dir + sep)) throw new Error(`unsafe asset path: ${rel}`)
  return full
}

// Hash a local file (streamed, never buffered whole) to confirm a reuse
// candidate really is the asset we'd otherwise download.
async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (c) => hash.update(c))
      .on('error', reject)
      .on('end', () => resolve())
  })
  return hash.digest('hex')
}

// Avoid re-downloading an asset that already exists, byte-identical, in another
// installed version of the same plugin. The common case is an engine update
// that only changes the binaries: the multi-GB GGUF weights are unchanged (same
// sha256), and the previous version is still on disk (prune keeps active + one
// prior). Hardlinking shares the underlying data, so a later prune of the old
// version dir leaves this link intact — no re-download, no orphaning, no extra
// disk. Same plugin root → same filesystem, so linkSync always applies; any
// failure just falls through to a normal download.
async function tryReuseFromSibling(
  manifest: PluginManifest,
  asset: PluginAsset,
  dest: string
): Promise<boolean> {
  if (!asset.sha256) return false
  const root = pluginDir(manifest.id)
  let versions: string[]
  try {
    versions = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== manifest.version && !d.name.endsWith('.staging'))
      .map((d) => d.name)
  } catch {
    return false // no prior versions installed
  }

  for (const v of versions) {
    let candidate: string
    try {
      candidate = within(join(root, v), asset.path)
    } catch {
      return false // a traversing path is never reused; the write site rejects it too
    }
    try {
      const st = statSync(candidate)
      if (asset.bytes && st.size !== asset.bytes) continue // cheap reject before hashing
      if ((await sha256File(candidate)) !== asset.sha256) continue
      mkdirSync(join(dest, '..'), { recursive: true })
      linkSync(candidate, dest)
      log('info', 'asset reused from sibling version', {
        id: manifest.id,
        asset: asset.path,
        from: v
      })
      return true
    } catch {
      continue // missing/changed/cross-device → try the next version, else download
    }
  }
  return false
}

// Install one manifest version, then activate it. Assets are written into a
// .staging sibling and renamed into place only once every download+hash
// succeeds, so a failed/partial install never leaves a usable-looking folder.

type ProgressFn = (p: InstallProgress) => void

export interface InstallOptions {
  onProgress?: ProgressFn
  signal?: AbortSignal // user cancel; aborts the in-flight asset download
}

// Windows can report ENOTEMPTY while Defender, indexing, or extract-zip still
// has a just-unpacked runtime directory open. Node retries these transient
// recursive-removal errors only when asked, so use that facility for staging
// trees instead of turning a recoverable cleanup race into a failed install.
function removeStaging(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

// The same scanners can briefly hold a file inside a freshly written staging
// tree, which makes the directory rename fail with EPERM/EACCES/EBUSY. Retry
// those for up to ~2 s on Windows; anything else, or a persistent lock, fails.
const TRANSIENT_RENAME = new Set(['EPERM', 'EACCES', 'EBUSY'])

async function renameStaging(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      if (process.platform !== 'win32' || !TRANSIENT_RENAME.has(code) || attempt >= 10) throw e
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}

async function writeAssets(
  manifest: PluginManifest,
  dir: string,
  { onProgress, signal }: InstallOptions = {}
): Promise<void> {
  const assets = manifest.assets
  // Sum of declared bytes — 0 if ANY asset omits a count, so the UI knows the
  // overall percent isn't trustworthy and shows an indeterminate bar instead.
  const overallTotal = assets.every((a) => a.bytes) ? assets.reduce((s, a) => s + a.bytes, 0) : 0
  let completed = 0 // bytes from assets already finished
  let lastPercent = -1 // throttle: only emit on integer-percent change (or asset hop)

  for (const [i, asset] of assets.entries()) {
    const dest = within(dir, asset.path)

    // Reuse a byte-identical copy from a previously-installed version instead of
    // re-downloading (the big win on engine updates: unchanged GGUF weights).
    if (await tryReuseFromSibling(manifest, asset, dest)) {
      if (asset.executable) chmodSync(dest, 0o755)
      completed += asset.bytes
      const overallReceived = completed
      const percent = overallTotal ? Math.floor((overallReceived / overallTotal) * 100) : 0
      lastPercent = percent
      onProgress?.({
        id: manifest.id,
        version: manifest.version,
        asset: asset.path,
        assetIndex: i,
        assetCount: assets.length,
        received: asset.bytes,
        total: asset.bytes,
        overallReceived,
        overallTotal,
        percent
      })
      continue
    }

    await downloadAsset(asset, dest, {
      signal,
      onProgress: onProgress
        ? (d): void => {
            const overallReceived = completed + d.received
            const percent = overallTotal ? Math.floor((overallReceived / overallTotal) * 100) : 0
            // One event per integer percent, plus the first byte of each asset,
            // so an 8 GB install yields ~100 events, not one per 64 KB chunk.
            if (percent === lastPercent && d.received !== d.total) return
            lastPercent = percent
            onProgress({
              id: manifest.id,
              version: manifest.version,
              asset: asset.path,
              assetIndex: i,
              assetCount: assets.length,
              received: d.received,
              total: d.total,
              overallReceived,
              overallTotal,
              percent
            })
          }
        : undefined
    }) // streams to dest; creates parent dirs
    completed += asset.bytes
    if (asset.executable) chmodSync(dest, 0o755)
    // Archive assets (e.g. a training pack's embedded runtime) extract into
    // the staging dir only after their hash verified, then the archive goes —
    // the extracted tree is the payload, not the zip. extract-zip refuses
    // entries whose parent escapes the target directory; assertSafeZipEntry
    // also refuses symlink entries (which extract-zip would create verbatim)
    // and names Windows would misread (zip-guard.ts).
    if (asset.unpack === 'zip') {
      if (signal?.aborted) throw new Error('install cancelled')
      await extractZip(dest, { dir: dir, onEntry: assertSafeZipEntry })
      rmSync(dest, { force: true })
      if (signal?.aborted) throw new Error('install cancelled')
    }
  }
  // Persist the (already signature-verified) manifest beside its assets so the
  // host can relaunch this version's sidecar after a rollback without refetching.
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

export async function installManifest(
  manifest: PluginManifest,
  opts: InstallOptions = {}
): Promise<void> {
  const finalDir = versionDir(manifest.id, manifest.version)
  if (existsSync(finalDir)) {
    writePointer(manifest.id, manifest.version) // already on disk — just activate
    return
  }

  const staging = `${finalDir}.staging`
  removeStaging(staging)
  mkdirSync(staging, { recursive: true })
  try {
    await writeAssets(manifest, staging, opts)
    mkdirSync(pluginDir(manifest.id), { recursive: true })
    await renameStaging(staging, finalDir)
  } catch (e) {
    removeStaging(staging)
    throw e
  }

  writePointer(manifest.id, manifest.version)
  log('info', 'plugin installed', { id: manifest.id, version: manifest.version })
}
