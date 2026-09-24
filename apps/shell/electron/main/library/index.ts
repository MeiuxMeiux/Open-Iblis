// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Electron wiring for the library: the singleton store at userData, the
// tracks-root layout (tracks/<ulid>/audio.wav), the one-time orphan import,
// the iblis-track:// stream protocol, and the OS-facing verbs (reveal, trash,
// drag-out). Logic lives in ./store and ./import; this file is the thin,
// Electron-coupled adapter.

import { protocol, shell, nativeImage, type WebContents } from 'electron'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import type {
  AudioAnalysis,
  LibraryFolder,
  LibraryOrganizerSnapshot,
  LibraryPrompt,
  LibraryTrack,
  MediaObservation
} from '../../../shared/contract'
import type { TrackDetail } from '../../../shared/generation-record'
import { log } from '../logger'
import { errorMessage } from '../error-message'
import { createLibraryStore, type LibraryStore, type TrackRecord } from './store'
import { importOrphans } from './import'
import { mediaMime, respondWithLocalFile } from '../media/file'
import type { WavMetadata } from '../media/wav'
import type { EngineGenerationEvidence } from '../engine'
import { mediaObservationFields } from '../media/observation'
import {
  blockTrackAnalysis,
  ensureTrackAnalysis,
  releaseTrackAnalysis,
  scheduleTrackAnalysis
} from './analysis'
import { addGenerationAnalysis, readGenerationRecord, writeGenerationRecord } from './provenance'
import { trackDirectory, trackStorage } from './paths'
import { commitTrackDeletion, recoverStagedTrackDeletions, stagedTrackDirectory } from './deletion'
import { toRendererFolder, toRendererPrompt, toRendererTrack, withDetectedFacts } from './views'
import {
  cancelProcessorTrack,
  detectedFactsByTrack,
  processorJobs,
  processorResults,
  scheduleProcessorAnalysis
} from '../processors'
import { heavyDataRoot } from '../storage'
import { ignoreFailure } from '../ignore-failure'

// Generated tracks land under here (IBLIS_TRACKS_DIR overrides for tests).
function tracksRoot(): string {
  // An empty override counts as unset.
  const override = process.env.IBLIS_TRACKS_DIR
  if (override) return override
  return join(heavyDataRoot(), 'tracks')
}

let store: LibraryStore | null = null
let ready: Promise<LibraryStore> | null = null

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | null)?.code ?? 'unknown'
}

async function discardTrackDirectory(directory: string): Promise<boolean> {
  try {
    await shell.trashItem(directory)
    return true
  } catch (trashError) {
    try {
      await rm(directory, { recursive: true, force: true })
      return true
    } catch (removeError) {
      log('warn', 'track media cleanup deferred', {
        trashCode: errorCode(trashError),
        removeCode: errorCode(removeError)
      })
      return false
    }
  }
}

// First touch creates the store and sweeps pre-alpha.7 orphan WAVs into it.
function library(): Promise<LibraryStore> {
  if (!ready) {
    store = createLibraryStore({ file: join(tracksRoot(), 'library.json') })
    const s = store
    ready = recoverStagedTrackDeletions({
      root: tracksRoot(),
      hasRecord: async (id) => !!(await s.get(id)),
      discardStaged: discardTrackDirectory
    })
      .then((recovery) => {
        if (recovery.restored || recovery.discarded || recovery.retained) {
          log('info', 'library deletion recovery completed', { ...recovery })
        }
        return importOrphans(tracksRoot(), s)
      })
      .then((n) => {
        if (n > 0) log('info', 'library imported orphan tracks', { count: n })
        return s
      })
      .catch((e: unknown) => {
        log('error', 'library startup recovery failed', { code: errorCode(e) })
        return s
      })
  }
  return ready
}

async function authorizedTrack(track: TrackRecord): Promise<TrackRecord> {
  const { audioFile } = await trackStorage(tracksRoot(), track)
  return { ...track, filePath: audioFile }
}

// Persist a finished generation as a library track. Called by the engine's
// writeWav seam; returns a path-free track identity for JobResult.
export async function addGeneratedTrack(
  bytes: Buffer,
  req: GenerateRequest,
  metadata: WavMetadata,
  engine?: { id: string; version: string | null },
  generationJobId?: string
): Promise<TrackRecord> {
  const lib = await library()
  const id = lib.mintId()
  const dir = join(tracksRoot(), id)
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, 'audio.wav')
  await writeFile(filePath, bytes)
  const track = await lib.add({
    id,
    prompt: req.prompt,
    ...(req.lyrics ? { lyrics: req.lyrics } : {}),
    filePath,
    format: 'wav',
    requestedDurationSec: req.durationSec,
    durationSec: metadata.durationSec,
    audio: metadata,
    ...(req.seed !== undefined ? { seed: req.seed } : {}),
    ...(req.config && Object.keys(req.config).length > 0 ? { config: req.config } : {}),
    preset: req.preset,
    ...(engine ? { enginePluginId: engine.id } : {}),
    ...(engine?.version ? { enginePluginVersion: engine.version } : {}),
    ...(generationJobId ? { generationJobId } : {})
  })
  log('info', 'generated media validated', {
    trackId: track.id,
    requestedDurationSec: req.durationSec,
    containerDurationSec: metadata.durationSec,
    frames: metadata.frames,
    sampleRateHz: metadata.sampleRateHz,
    channels: metadata.channels,
    bitsPerSample: metadata.bitsPerSample,
    codec: metadata.codec,
    containerBytes: metadata.containerBytes
  })
  scheduleTrackAnalysis(track)
  void scheduleProcessorAnalysis(track.id).catch(ignoreFailure)
  return track
}

// Retain an engine's validated sibling output next to the master. Immutable
// artifacts get their own records in the Phase 5 slice; until then the file
// is named by role so provenance can point at it.
export async function saveTrackSiblingOutput(
  id: string,
  role: 'preview',
  bytes: Buffer
): Promise<boolean> {
  const track = await (await library()).get(id)
  if (!track) return false
  await writeFile(join(dirname(track.filePath), `${role}.wav`), bytes)
  return true
}

export async function saveTrackGeneration(
  id: string,
  evidence: EngineGenerationEvidence
): Promise<void> {
  const track = await (await library()).get(id)
  if (!track) throw new Error(`unknown track ${id}`)
  const stored = await authorizedTrack(track)
  await writeGenerationRecord(stored, evidence)
  scheduleTrackAnalysis(stored, (analysis) => addGenerationAnalysis(stored, analysis))
}

export async function listTracks(): Promise<LibraryTrack[]> {
  // Detected facts come from the processors store in one bulk pass; rows must
  // never trigger a per-track results fetch.
  const facts = detectedFactsByTrack()
  return (await (await library()).list()).map((track) => {
    const detected = facts[track.id]
    return { ...toRendererTrack(track), ...(detected ? { detected } : {}) }
  })
}

export async function getTrackDetail(id: string, includeAnalysis = true): Promise<TrackDetail> {
  const track = await (await library()).get(id)
  if (!track) throw new Error(`unknown track ${id}`)
  const stored = await authorizedTrack(track)
  const generation = await readGenerationRecord(stored)
  let analysis: AudioAnalysis | undefined
  let analysisError: string | undefined
  if (includeAnalysis) {
    try {
      analysis = await ensureTrackAnalysis(stored)
      if (generation) await addGenerationAnalysis(stored, analysis)
    } catch (error) {
      analysisError = (error as Partial<Error> | null)?.message ?? 'track analysis unavailable'
    }
  }
  const detected = processorResults(id)
  const jobs = processorJobs(id)
  return {
    track: toRendererTrack(stored),
    provenance: generation ? 'recorded' : stored.tags.includes('imported') ? 'imported' : 'legacy',
    ...(generation ? { generation: (await readGenerationRecord(stored)) ?? generation } : {}),
    ...(analysis ? { analysis } : {}),
    ...(analysisError ? { analysisError } : {}),
    ...(detected.length ? { processorResults: detected } : {}),
    ...(jobs.length ? { processorJobs: jobs } : {})
  }
}

// Remember a prompt the moment a generation starts (not when it finishes —
// a cancelled take is still history worth recalling). Fire-and-forget.
export async function recordPromptUse(text: string): Promise<void> {
  if (!text.trim()) return
  await (await library()).recordPromptUse(text)
}

export async function listPrompts(): Promise<LibraryPrompt[]> {
  return (await (await library()).listPrompts()).map(toRendererPrompt)
}

export async function starPrompt(id: string, starred: boolean): Promise<LibraryPrompt> {
  return toRendererPrompt(await (await library()).starPrompt(id, starred))
}

export async function removePrompt(id: string): Promise<void> {
  await (await library()).removePrompt(id)
}

export async function clearPrompts(): Promise<number> {
  return (await library()).clearPrompts()
}

export async function renameTrack(id: string, name: string): Promise<LibraryTrack> {
  return withDetectedFacts(toRendererTrack(await (await library()).rename(id, name)))
}

export async function rateTrack(id: string, rating: -1 | 0 | 1): Promise<LibraryTrack> {
  return withDetectedFacts(toRendererTrack(await (await library()).rate(id, rating)))
}

export async function listFolders(): Promise<LibraryFolder[]> {
  return (await (await library()).listFolders()).map(toRendererFolder)
}

export async function createFolder(name: string): Promise<LibraryFolder> {
  return toRendererFolder(await (await library()).createFolder(name))
}

export async function renameFolder(id: string, name: string): Promise<LibraryFolder> {
  return toRendererFolder(await (await library()).renameFolder(id, name))
}

export async function removeFolder(id: string): Promise<LibraryOrganizerSnapshot> {
  const removed = await (await library()).removeFolder(id)
  return {
    tracks: removed.tracks.map(toRendererTrack),
    folders: removed.folders.map(toRendererFolder)
  }
}

export async function moveTrackToFolder(id: string, folderId?: string): Promise<LibraryTrack> {
  return withDetectedFacts(toRendererTrack(await (await library()).moveToFolder(id, folderId)))
}

export async function getTrackAnalysis(id: string): Promise<AudioAnalysis> {
  const track = await (await library()).get(id)
  if (!track) throw new Error(`unknown track ${id}`)
  return ensureTrackAnalysis(await authorizedTrack(track))
}

// Processor host input boundary: a stored id becomes a main-authorized path
// only here. It is never exposed through IPC or reused for derived outputs.
export async function getProcessorInput(id: string): Promise<{
  id: string
  audioPath: string
  format: string
} | null> {
  const track = await (await library()).get(id)
  if (!track) return null
  try {
    const stored = await authorizedTrack(track)
    return { id: stored.id, audioPath: stored.filePath, format: stored.format }
  } catch {
    return null
  }
}

// Delete row + audio folder. The folder goes to the OS trash when possible
// (recoverable beats gone); hard-delete is the fallback.
export async function deleteTrack(id: string): Promise<void> {
  const lib = await library()
  const track = await lib.get(id)
  if (!track) return
  const directory = await trackDirectory(tracksRoot(), track.id)
  await blockTrackAnalysis(id)
  await cancelProcessorTrack(id).catch(ignoreFailure)
  try {
    try {
      await commitTrackDeletion({
        directory,
        ...(directory ? { stagedDirectory: stagedTrackDirectory(tracksRoot(), track.id) } : {}),
        removeRecord: async () => {
          await lib.remove(id)
        },
        discardStaged: discardTrackDirectory
      })
    } catch (error) {
      log('warn', 'track deletion failed safely', { trackId: id, code: errorCode(error) })
      throw new Error('track could not be deleted safely', { cause: error })
    }
  } finally {
    releaseTrackAnalysis(id)
  }
}

export async function revealTrack(id: string): Promise<void> {
  const track = await (await library()).get(id)
  if (!track) throw new Error(`unknown track ${id}`)
  shell.showItemInFolder((await trackStorage(tracksRoot(), track)).audioFile)
}

// 16x16 accent-purple dot, inlined: webContents.startDrag requires a non-empty
// icon on Windows, and the renderer can't hand us one (no fs access).
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgoAWoifn/Hxum' +
    'SDNRhhDSjNcQYjVjNYRUzRiGjBpABQMojkaqJCRiDcGrmZAhRGkmFQAAMoa6eB6uLr4AAAAASUVORK5CYII='
)

export async function startTrackDrag(sender: WebContents, id: string): Promise<void> {
  const track = await (await library()).get(id)
  if (!track) return
  sender.startDrag({ file: (await trackStorage(tracksRoot(), track)).audioFile, icon: DRAG_ICON })
}

// Chromium is an independent parser. Capture its duration and seekable range
// beside our exact RIFF facts in structured logs so mismatches have evidence.
export async function recordMediaObservation(
  id: string,
  observation: MediaObservation
): Promise<void> {
  const track = await (await library()).get(id)
  if (!track) throw new Error(`unknown track ${id}`)
  log('info', 'browser media observed', mediaObservationFields(id, track, observation))
}

// iblis-track://<id> streams a track's audio to the renderer without opening
// fs or network access: the id is resolved through the store (never a path
// from the renderer). The explicit responder owns HEAD and byte ranges rather
// than inheriting opaque file:// behavior from Electron.
export function registerTrackProtocol(): void {
  protocol.handle('iblis-track', async (request) => {
    const id = new URL(request.url).hostname
    const track = await (await library()).get(id)
    const notFound = () => new Response(null, { status: 404, headers: { 'Content-Length': '0' } })
    if (!track) return notFound()
    const storage = await trackStorage(tracksRoot(), track).catch((error: unknown) => {
      log('warn', 'refused unsafe library media path', { trackId: id, error: String(error) })
      return null
    })
    if (!storage) return notFound()
    try {
      // Awaited so a read failure (EACCES, EIO) becomes a logged 404 rather
      // than a rejected protocol handler.
      return await respondWithLocalFile(request, storage.audioFile, mediaMime(track.format))
    } catch (error) {
      log('warn', 'library media read failed', { trackId: id, error: errorMessage(error) })
      return notFound()
    }
  })
}
