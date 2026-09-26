// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Electron wiring for stems: installed stem-split processors, the job host,
// the iblis-stem:// stream protocol, and reveal / drag-out / export. Paths
// are resolved here from ids and never cross the bridge.

import { app, BrowserWindow, dialog, protocol, shell, type WebContents } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isStemRole, type StemRole } from '@iblis/plugin-sdk'
import type {
  StemProviderView,
  StemSettings,
  StemsSnapshot,
  TrackStemsView
} from '../../../shared/stems'
import { STEM_LABELS, stemModelFacts } from '../../../shared/stems'
import { createStemSidecarClient } from './client'
import { createStemHost, type StemHost, type StemProviderInfo, type StemTrackInput } from './host'
import type { StemMeasurement } from './measure'
import { readStemSets, stemFilePath, stemSetDirectory, toStemSetView } from './promote'
import { createStemStore } from './store'
import createMeasureWorker from './measure-worker?nodeWorker'
import { readInstalledManifest } from '../plugins/installed-manifest'
import { listInstalled } from '../plugins/registry'
import { requestSidecar } from '../sidecar/supervisor'
import { respondWithLocalFile } from '../media/file'
import { parseWav } from '../media/wav'
import { log } from '../logger'

interface InstalledStemProvider {
  id: string
  name: string
  version: string
}

// Health is cached per plugin version: the model a sidecar serves cannot
// change without a new version, which is a new cache key.
const health = new Map<string, { model: string; stems: StemRole[] } | null>()
let host: StemHost | null = null

function installedStemProviders(): InstalledStemProvider[] {
  return listInstalled().flatMap((installed) => {
    if (!installed.activeVersion) return []
    const manifest = readInstalledManifest(installed.id, installed.activeVersion)
    if (manifest?.kind !== 'processor' || !manifest.executable) return []
    if (!manifest.capabilities.includes('stem-split')) return []
    return [{ id: manifest.id, name: manifest.name, version: manifest.version }]
  })
}

function client(id: string) {
  return createStemSidecarClient((path, init) => requestSidecar(id, path, init))
}

async function probe(provider: InstalledStemProvider): Promise<void> {
  const key = `${provider.id}@${provider.version}`
  if (health.get(key)) return
  try {
    const h = await client(provider.id).health()
    health.set(key, { model: h.model, stems: h.stems.map((s) => `stem.${s}`).filter(isStemRole) })
  } catch {
    health.set(key, null)
  }
}

function info(provider: InstalledStemProvider): StemProviderInfo | null {
  const h = health.get(`${provider.id}@${provider.version}`)
  return h ? { ...provider, model: h.model } : null
}

function providerInfo(id: string): StemProviderInfo | null {
  const found = installedStemProviders().find((p) => p.id === id)
  return found ? info(found) : null
}

function defaultProvider(settings: StemSettings): StemProviderInfo | null {
  const ready = installedStemProviders().flatMap((p) => info(p) ?? [])
  return (
    ready.find((p) => p.id === settings.defaultProvider) ??
    ready.find((p) => p.model === 'htdemucs') ??
    ready[0] ??
    null
  )
}

async function providerViews(): Promise<StemProviderView[]> {
  const installed = installedStemProviders()
  await Promise.all(installed.map(probe))
  return installed.map((p) => {
    const h = health.get(`${p.id}@${p.version}`)
    const facts = stemModelFacts(h?.model ?? '')
    return {
      ...p,
      model: h?.model ?? 'unknown',
      label: h ? facts.label : 'Starting',
      description: h ? facts.description : 'The separator is starting or did not respond.',
      stems: h?.stems ?? [],
      ready: Boolean(h)
    }
  })
}

function measure(files: { role: StemRole; path: string }[]): Promise<StemMeasurement[]> {
  return new Promise((resolve, reject) => {
    const worker = createMeasureWorker({ workerData: { files } })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('stem measurement timed out'))
    }, 10 * 60_000)
    worker.once(
      'message',
      (message: { ok: boolean; results?: StemMeasurement[]; message?: string }) => {
        clearTimeout(timer)
        void worker.terminate()
        if (message.ok && Array.isArray(message.results)) resolve(message.results)
        else reject(new Error(message.message ?? 'stem measurement failed'))
      }
    )
    worker.once('error', (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export interface StemHostWiring {
  input(trackId: string): Promise<{
    audioPath: string
    format: string
    audio?: { sampleRateHz: number; durationSec: number }
  } | null>
  mayRun(): Promise<boolean>
}

let wiring: StemHostWiring | null = null

async function trackInput(trackId: string): Promise<StemTrackInput | null> {
  const input = await wiring?.input(trackId)
  if (input?.format.toLowerCase() !== 'wav') return null
  let audio = input.audio
  if (!audio) {
    const facts = parseWav(await readFile(input.audioPath))
    audio = { sampleRateHz: facts.sampleRateHz, durationSec: facts.durationSec }
  }
  return { audioPath: input.audioPath, trackDir: dirname(input.audioPath), ...audio }
}

export async function initializeStems(deps: StemHostWiring): Promise<void> {
  if (host) return
  wiring = deps
  host = createStemHost({
    store: createStemStore(join(app.getPath('userData'), 'stem-jobs.json')),
    provider: providerInfo,
    defaultProvider,
    client,
    input: trackInput,
    mayRun: () => deps.mayRun(),
    measure,
    hash: sha256,
    onPromoted: (record) =>
      log('info', 'stem set promoted', {
        trackId: record.trackId,
        setId: record.id,
        provider: record.providerId,
        backend: record.backend,
        computeMs: record.computeMs
      })
  })
  await host.initialize()
  void providerViews().catch(() => undefined)
}

function stems(): StemHost {
  if (!host) throw new Error('stems are not initialized')
  return host
}

export async function stemsSnapshot(): Promise<StemsSnapshot> {
  return { settings: stems().settings(), providers: await providerViews() }
}

export async function setStemSettings(patch: Partial<StemSettings>): Promise<StemsSnapshot> {
  const next: Partial<StemSettings> = {}
  if (patch.backend !== undefined) next.backend = patch.backend
  if ('defaultProvider' in patch) next.defaultProvider = patch.defaultProvider ?? ''
  await stems().setSettings(next)
  return stemsSnapshot()
}

export async function trackStems(trackId: string): Promise<TrackStemsView> {
  const input = await trackInput(trackId).catch(() => null)
  const sets = input ? await readStemSets(input.trackDir, trackId) : []
  const job = host?.job(trackId)
  return { sets: sets.map(toStemSetView), ...(job ? { job } : {}) }
}

export async function splitTrack(trackId: string, providerId?: string): Promise<TrackStemsView> {
  if (providerId) {
    const found = installedStemProviders().find((p) => p.id === providerId)
    if (found) await probe(found)
  } else {
    await Promise.all(installedStemProviders().map(probe))
  }
  await stems().split(trackId, providerId)
  return trackStems(trackId)
}

export async function cancelStems(trackId: string): Promise<TrackStemsView> {
  await stems().cancel(trackId)
  return trackStems(trackId)
}

export async function cancelTrackStemWork(trackId: string): Promise<void> {
  await host?.removeTrack(trackId)
}

export async function acquireStemMutation(id: string): Promise<() => Promise<void>> {
  if (!host) return () => Promise.resolve()
  health.clear()
  return host.acquirePluginMutation(id)
}

async function resolveSet(trackId: string, setId: string): Promise<string> {
  const input = await trackInput(trackId)
  const dir = input ? await stemSetDirectory(input.trackDir, trackId, setId) : null
  if (!dir) throw new Error('stem set is unavailable')
  return dir
}

async function resolveFile(trackId: string, setId: string, role: unknown): Promise<string> {
  if (!isStemRole(role)) throw new Error('unknown stem')
  const input = await trackInput(trackId)
  const path = input ? await stemFilePath(input.trackDir, trackId, setId, role) : null
  if (!path) throw new Error('stem is unavailable')
  return path
}

export async function removeStemSet(trackId: string, setId: string): Promise<TrackStemsView> {
  const dir = await resolveSet(trackId, setId)
  // Recoverable beats gone: the OS trash first, a hard delete as fallback.
  await shell.trashItem(dir).catch(() => rm(dir, { recursive: true, force: true }))
  return trackStems(trackId)
}

export async function revealStem(trackId: string, setId: string, role: unknown): Promise<void> {
  shell.showItemInFolder(await resolveFile(trackId, setId, role))
}

export async function dragStem(
  sender: WebContents,
  trackId: string,
  setId: string,
  role: unknown,
  icon: Electron.NativeImage
): Promise<void> {
  sender.startDrag({ file: await resolveFile(trackId, setId, role), icon })
}

export async function exportStemSet(
  trackId: string,
  setId: string,
  window: BrowserWindow | null
): Promise<number> {
  const input = await trackInput(trackId)
  if (!input) throw new Error('track is unavailable')
  const set = (await readStemSets(input.trackDir, trackId)).find((s) => s.id === setId)
  if (!set) throw new Error('stem set is unavailable')
  const options = {
    title: 'Export stems to a folder',
    properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
  }
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  const target = picked.filePaths[0]
  if (picked.canceled || !target) return 0
  let copied = 0
  for (const file of set.files) {
    const source = await resolveFile(trackId, setId, file.role)
    const name = `${STEM_LABELS[file.role].toLowerCase()}-${trackId.slice(-6).toLowerCase()}.wav`
    await copyFile(source, join(target, name))
    copied++
  }
  return copied
}

// iblis-stem://<trackId>/<setId>/<role> streams one promoted stem. Every part
// is validated and re-resolved through the track store and the set record.
export function registerStemProtocol(): void {
  protocol.handle('iblis-stem', async (request) => {
    const notFound = () => new Response(null, { status: 404, headers: { 'Content-Length': '0' } })
    try {
      const url = new URL(request.url)
      const [setId, role] = url.pathname.replace(/^\/+/, '').split('/')
      if (!setId || !role) return notFound()
      const path = await resolveFile(url.hostname.toLowerCase(), setId, role).catch(() => null)
      return path ? await respondWithLocalFile(request, path, 'audio/wav') : notFound()
    } catch {
      return notFound()
    }
  })
}
