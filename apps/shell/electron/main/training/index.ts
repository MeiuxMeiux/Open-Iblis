// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Electron wiring for the Training arc: pack state, preflight, the wizard's
// scan/reserve steps, and the durable pipeline. The renderer only ever sees
// tokens, views, and progress events — never paths, ports, or URLs.

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { PluginManifest } from '@iblis/plugin-sdk'
import {
  type TrainingCategory,
  type TrainingJobView,
  type TrainingPackState,
  type TrainingPreflightReport,
  type TrainingProgressEvent,
  type TrainingReserveResult,
  type TrainingScanResult,
  type TrainingStartInput,
  type TrainingVisibility,
  TRAINING_NAME_PATTERN,
  MAX_TRACKS_HARD_STOP
} from '../../../shared/training'
import { freeDiskBytes, gpuMemory } from '../hardware'
import { evaluateTrainingPreflight } from '../hardware/preflight'
import { queueSnapshot } from '../generation-queue'
import { perfInfo } from '../perf'
import { readInstalledManifest } from '../plugins/installed-manifest'
import { listInstalled } from '../plugins/registry'
import { healthAll, requestSidecar, start, stop } from '../sidecar/supervisor'
import { resourceCoordinator } from '../resource-state'
import { downloadAdapterFile, importAdapterFile, listAdapters } from '../adapters'
import { currentLeaseForFeature } from '../licensing'
import { serviceEndpoint } from '../official-endpoints'
import { log } from '../logger'
import { createTrainingPipeline, type TrainingPipeline } from './pipeline'
import { createTrainingSidecarClient, type SidecarScalar } from './sidecar-client'
import { createTrainingStore } from './store'
import { createUploadFlow, type UploadFlow } from './upload-flow'
import { reserveTrainingName, trainingsConfigured, trainingsRequest } from './remote'
import { checkPrivateName, NAME_RULES, privateImports, trainingVisibility } from './private'
import { heavyDataRoot } from '../storage'
import { ignoreFailure } from '../ignore-failure'

const TRAINING_PACK_ID = 'mx.iblis.training.acestep'

export function trainingPackState(): TrainingPackState {
  const installed = listInstalled().find((plugin) => plugin.id === TRAINING_PACK_ID)
  return {
    installed: Boolean(installed?.activeVersion),
    version: installed?.activeVersion ?? null
  }
}

function packManifest(): PluginManifest {
  const state = trainingPackState()
  if (!state.installed || !state.version) throw new Error('the training pack is not installed')
  const manifest = readInstalledManifest(TRAINING_PACK_ID, state.version)
  if (!manifest?.executable) throw new Error('the installed training pack has no sidecar entry')
  return manifest
}

function trainingScratchRoot(): string {
  return join(heavyDataRoot(), 'training')
}

export async function trainingPreflight(trackCount?: number): Promise<TrainingPreflightReport> {
  const [memory, freeBytes, snapshot] = await Promise.all([
    gpuMemory(),
    freeDiskBytes(heavyDataRoot()),
    queueSnapshot()
  ])
  return evaluateTrainingPreflight({
    vramTotalMb: memory.totalMb,
    freeDiskBytes: freeBytes,
    queueBusy: Boolean(snapshot.activeId) || snapshot.pendingCount > 0,
    packInstalled: trainingPackState().installed,
    trackCount
  })
}

// ---- sidecar lifecycle (on demand, never at app boot) ----

async function ensureSidecarRunning(): Promise<void> {
  if (healthAll()[TRAINING_PACK_ID]?.running) return
  await start(packManifest())
}

async function stopSidecar(): Promise<void> {
  if (healthAll()[TRAINING_PACK_ID]) await stop(TRAINING_PACK_ID)
}

const sidecarClient = createTrainingSidecarClient({
  request: (path, init) => requestSidecar(TRAINING_PACK_ID, path, init)
})

// ---- wizard step 1-2: folder pick + scan (probe only, pre-consent) ----

// Opaque folder tokens: the renderer holds a token, main holds the path.
const folderTokens = new Map<string, string>()

async function sha256File(path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256')
  let bytes = 0
  const stream = createReadStream(path, { highWaterMark: 256 * 1024 })
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    bytes += chunk.length
    hash.update(chunk)
  }
  return { bytes, sha256: hash.digest('hex') }
}

export async function scanTrainingFolder(
  owner: BrowserWindow | null
): Promise<TrainingScanResult | null> {
  const options = {
    title: 'Choose a folder of your songs',
    properties: ['openDirectory' as const]
  }
  const picked = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  const [folderPath] = picked.filePaths
  if (picked.canceled || picked.filePaths.length !== 1 || folderPath === undefined) return null

  await ensureSidecarRunning()
  let result: unknown
  try {
    result = await sidecarClient.runStage('scan', `probe-${randomUUID()}`, {
      source: folderPath,
      ingest: false,
      maxTracks: MAX_TRACKS_HARD_STOP
    })
  } finally {
    // A probe must not keep a multi-GB Python runtime resident.
    if (!pipelineSingleton || !pipelineActive()) await stopSidecar().catch(ignoreFailure)
  }
  // The sidecar's JSON is untrusted: any field may be missing or mistyped.
  const summary = result as
    | {
        trackCount?: SidecarScalar
        totalDurationSec?: SidecarScalar
        skipped?: ({ name?: SidecarScalar; reason?: SidecarScalar } | null)[] | null
      }
    | null
    | undefined
  const trackCount = Number(summary?.trackCount ?? 0)
  const token = randomUUID()
  folderTokens.set(token, folderPath)
  const [preflight, memory] = await Promise.all([trainingPreflight(trackCount), gpuMemory()])
  return {
    folderToken: token,
    folderName: folderPath.split(/[\\/]/).pop() ?? 'folder',
    trackCount,
    totalDurationSec: Math.round(Number(summary?.totalDurationSec ?? 0)),
    skipped: (summary?.skipped ?? []).map((item) => ({
      name: String(item?.name ?? 'unknown'),
      reason: String(item?.reason ?? 'unsupported')
    })),
    preflight,
    vramTotalMb: memory.totalMb
  }
}

// ---- wizard step 3: name reservation ----

const pendingReservations = new Map<
  string,
  { claimToken: string; visibility: TrainingVisibility }
>()

// Community when this install may publish (a trainings endpoint and a live
// styles-community lease); private otherwise. Main decides, never the renderer.
export function currentTrainingVisibility(): TrainingVisibility {
  return trainingVisibility(
    serviceEndpoint('trainings') !== null,
    currentLeaseForFeature('styles-community')
  )
}

// A private name never reaches the trainings service: same rules as the
// server, unique among this machine's trainings and Styles.
async function reservePrivate(name: string): Promise<TrainingReserveResult> {
  const [jobs, styles] = await Promise.all([pipeline(), listAdapters()])
  const result = checkPrivateName(
    name,
    jobs.list().map((job) => job.name),
    styles.map((style) => style.displayName)
  )
  if (result.available && result.trainingId) {
    pendingReservations.set(result.trainingId, { claimToken: '', visibility: 'private' })
  }
  return result
}

export async function reserveTraining(
  name: string,
  categories: TrainingCategory[]
): Promise<TrainingReserveResult> {
  if (currentTrainingVisibility() === 'private') return reservePrivate(name)
  if (!TRAINING_NAME_PATTERN.test(name)) {
    return { available: false, visibility: 'community', message: NAME_RULES }
  }
  const result = await reserveTrainingName(name, categories)
  if (result.available && result.reserved) {
    pendingReservations.set(result.reserved.trainingId, {
      claimToken: result.reserved.claimToken,
      visibility: 'community'
    })
  }
  return {
    available: result.available,
    visibility: 'community',
    trainingId: result.trainingId,
    version: result.version,
    message: result.message
  }
}

// ---- pipeline singleton ----

let pipelineSingleton: TrainingPipeline | null = null
let pipelineReady: Promise<TrainingPipeline> | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function buildPipeline(): TrainingPipeline {
  return createTrainingPipeline({
    store: createTrainingStore(join(trainingScratchRoot(), 'jobs.json')),
    sidecar: {
      ensureRunning: ensureSidecarRunning,
      stop: stopSidecar,
      client: () => sidecarClient
    },
    lock: { beginTraining: () => resourceCoordinator().beginTraining() },
    threads: () => perfInfo().threads.balanced,
    hashFile: sha256File,
    emitProgress: (event: TrainingProgressEvent) => broadcast('training:progress', event),
    emitJobs: (jobs: TrainingJobView[]) => broadcast('training:jobs', jobs),
    // A private job ends by adding its adapters to the local Styles library.
    // Imports are content-addressed, so a resumed register stage is idempotent.
    registerLocal: async (record) => {
      for (const item of privateImports(record, Date.now())) {
        await importAdapterFile(item.path, item.details)
      }
    },
    // Community job: local stages done -> the upload starts on its own.
    onLocalComplete: (jobId) => {
      void uploadFlow()
        .then((flow) => flow.process(jobId))
        .catch((error: unknown) =>
          log('error', 'training upload flow failed', { error: String(error) })
        )
    }
  })
}

// ---- upload + pull-down flow (shell-owned network stages) ----

let uploadFlowSingleton: UploadFlow | null = null

async function readSlice(path: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function uploadFlow(): Promise<UploadFlow> {
  const target = await pipeline()
  uploadFlowSingleton ??= createUploadFlow({
    pipeline: target,
    request: trainingsRequest,
    readSlice,
    hashFile: sha256File,
    download: async (source, dest) => {
      await downloadAdapterFile(source, dest)
    },
    registerAdapter: importAdapterFile,
    tempDir: () => mkdtemp(join(trainingScratchRoot(), 'pulldown-')),
    removeTemp: (path) => rm(path, { recursive: true, force: true }),
    emitProgress: (event) => broadcast('training:progress', event)
  })
  return uploadFlowSingleton
}

export async function retryTrainingUpload(jobId: string): Promise<void> {
  await (await uploadFlow()).retry(jobId)
}

async function pipeline(): Promise<TrainingPipeline> {
  if (!pipelineReady) {
    const created = buildPipeline()
    pipelineSingleton = created
    pipelineReady = created.init().then(() => created)
  }
  return pipelineReady
}

function pipelineActive(): boolean {
  return Boolean(pipelineSingleton?.activeJobId())
}

// ---- wizard step 5: launch ----

export async function startTraining(input: TrainingStartInput): Promise<TrainingJobView> {
  const folderPath = folderTokens.get(input.folderToken)
  if (!folderPath) throw new Error('Pick the song folder again — the selection expired.')
  const reservation = pendingReservations.get(input.trainingId)
  if (!reservation) throw new Error('Reserve the training name again — the claim expired.')
  const community = reservation.visibility === 'community'
  if (!input.rightsAttested || (community && !input.publicUploadAcknowledged)) {
    throw new Error('The training acknowledgements are required before anything runs.')
  }
  const preflight = await trainingPreflight()
  if (!preflight.ok) throw new Error('The hardware preflight is failing; fix its rows first.')

  const target = await pipeline()
  const scratchDir = join(trainingScratchRoot(), input.trainingId)
  await mkdir(scratchDir, { recursive: true })
  const acknowledgedAt = Date.now()
  // Tier the trainer to this card's VRAM (best-effort; null -> the pack's
  // smallest safe tier). Power-user overrides ride alongside.
  const { totalMb: vramTotalMb } = await gpuMemory()
  const view = await target.start({
    name: input.name,
    trainingId: input.trainingId,
    version: input.version,
    claimToken: reservation.claimToken,
    categories: input.categories,
    visibility: reservation.visibility,
    folderPath,
    scratchDir,
    folder: { trackCount: 0, totalDurationSec: 0 },
    consent: {
      publicUploadAcknowledgedAt: community ? acknowledgedAt : null,
      rightsAttestedAt: acknowledgedAt
    },
    vramTotalMb,
    advanced: input.advanced
  })
  pendingReservations.delete(input.trainingId)
  folderTokens.delete(input.folderToken)
  return view
}

export async function listTrainingJobs(): Promise<TrainingJobView[]> {
  return (await pipeline()).list()
}

export async function cancelTraining(jobId: string): Promise<void> {
  await (await pipeline()).cancel(jobId)
}

export async function resumeTraining(jobId: string): Promise<TrainingJobView> {
  return (await pipeline()).resume(jobId)
}

export async function deleteTrainingJob(jobId: string): Promise<void> {
  const target = await pipeline()
  const record = target.getRecord(jobId)
  await target.deleteJob(jobId)
  // Deleting a job clears its scratch; exported artifacts under output/ go
  // with it (they are re-creatable by training again, and live server-side
  // once uploaded).
  if (record?.scratchDir.startsWith(trainingScratchRoot())) {
    await rm(record.scratchDir, { recursive: true, force: true }).catch(ignoreFailure)
  }
}

export async function initializeTraining(): Promise<void> {
  const target = await pipeline()
  // Resume interrupted network stages: uploads continue by part, published
  // trainings finish their pull-down. Local (GPU) stages never auto-resume —
  // that is the user's Resume button.
  if (!trainingsConfigured()) return
  for (const job of target.list()) {
    if (job.status === 'uploading' || (job.status === 'awaiting-upload' && !job.error)) {
      void uploadFlow()
        .then((flow) => flow.process(job.id))
        .catch((error: unknown) =>
          log('error', 'training upload resume failed', { error: String(error) })
        )
    }
  }
}
