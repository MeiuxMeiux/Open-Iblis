// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { execFile } from 'node:child_process'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { dialog, type BrowserWindow } from 'electron'
import type { GenerateRequest, PluginManifest } from '@iblis/plugin-sdk'
import type {
  AdapterCompatibilityProof,
  AdapterProofEngineSnapshot,
  AdapterProofProgress
} from '../../../shared/adapters'
import { copyAdapterForCompatibilityProof } from '.'
import { resourceCoordinator } from '../resource-state'
import { vramUsedMb } from '../hardware'
import { createEngineClient } from '../engine/drivers/ace-compat/client'
import { readEngineProps, type EngineProps } from '../engine/drivers/ace-compat/props'
import { readInstalledManifest } from '../plugins/installed-manifest'
import { listInstalled } from '../plugins/registry'
import { versionDir } from '../plugins/paths'
import { hotSwap, requestSidecar } from '../sidecar/supervisor'
import { heavyDataRoot } from '../storage'
import { ignoreFailure } from '../ignore-failure'
import { errorMessage } from '../error-message'

const ENGINE_ID = 'mx.iblis.engine.acestep'
const ENGINE_VERSION = '0.1.4'
const ENGINE_BIN = 'ace-server.exe'
const ENGINE_ARGS = ['--models', '.', '--host', '127.0.0.1', '--keep-loaded']
const MAX_HELP_BYTES = 64 * 1024
const HELP_TIMEOUT_MS = 30_000
const PROOF_DURATION_SEC = 8
const PROOF_SEED = 1_857_349_211
const PROOF_LM_SEED = 1_285_977_421
const execFileAsync = promisify(execFile)

type Progress = (progress: AdapterProofProgress) => void

interface ActiveEngine {
  manifest: PluginManifest
  executable: NonNullable<PluginManifest['executable']>
  executableSha256: string
  executableBytes: number
}

function progress(send: Progress, stage: AdapterProofProgress['stage'], detail: string): void {
  send({ stage, detail })
}

function sameStrings(actual: string[] | undefined, expected: readonly string[]): boolean {
  return (
    !!actual &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

function activeEngine(): ActiveEngine {
  const installed = listInstalled().find((plugin) => plugin.id === ENGINE_ID)
  if (installed?.activeVersion !== ENGINE_VERSION) {
    throw new Error(`Engine compatibility proof requires active ${ENGINE_ID}@${ENGINE_VERSION}`)
  }
  const manifest = readInstalledManifest(ENGINE_ID, ENGINE_VERSION)
  const executable = manifest?.executable
  if (
    manifest?.kind !== 'engine' ||
    executable?.bin !== ENGINE_BIN ||
    !sameStrings(executable.args, ENGINE_ARGS)
  ) {
    throw new Error('The active engine manifest is not the expected signed ACE-Step 0.1.4 pack')
  }
  const asset = manifest.assets.find((item) => item.path === ENGINE_BIN)
  if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes)) {
    throw new Error('The active engine manifest has no valid executable integrity record')
  }
  return { manifest, executable, executableSha256: asset.sha256, executableBytes: asset.bytes }
}

async function sha256File(path: string, expectedBytes: number): Promise<string> {
  // A stream through the hash avoids loading the native binary into memory.
  const hash = createHash('sha256')
  let bytes = 0
  const stream: AsyncIterable<Buffer> = createReadStream(path, { highWaterMark: 128 * 1024 })
  for await (const chunk of stream) {
    bytes += chunk.length
    if (bytes > expectedBytes) throw new Error('Engine executable bytes exceed the signed manifest')
    hash.update(chunk)
  }
  if (bytes !== expectedBytes)
    throw new Error('Engine executable bytes differ from the signed manifest')
  return hash.digest('hex')
}

function boundedHelp(value: unknown): string {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '')
  return Buffer.from(text, 'utf8').subarray(0, MAX_HELP_BYTES).toString('utf8')
}

async function captureHelp(active: ActiveEngine): Promise<string> {
  const { manifest, executable } = active
  const path = join(versionDir(manifest.id, manifest.version), executable.bin)
  try {
    const result = await execFileAsync(path, ['--help'], {
      cwd: versionDir(manifest.id, manifest.version),
      windowsHide: true,
      timeout: HELP_TIMEOUT_MS,
      maxBuffer: MAX_HELP_BYTES
    })
    return boundedHelp(`${result.stdout}\n${result.stderr}`)
  } catch (error) {
    const detail = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
    throw new Error(`ACE-Step --help failed: ${boundedHelp(detail.stderr ?? detail.message)}`, {
      cause: error
    })
  }
}

function snapshot(
  startedAt: number,
  props: EngineProps,
  vram: number | null
): AdapterProofEngineSnapshot {
  return {
    startupMs: Math.max(0, Date.now() - startedAt),
    vramMb: vram,
    lmModels: props.lmModels,
    synthModels: props.synthModels,
    adapters: props.adapters
  }
}

function manifestWithAdapterRoot(active: ActiveEngine, root: string): PluginManifest {
  const { manifest, executable } = active
  return {
    ...manifest,
    executable: { ...executable, args: [...(executable.args ?? []), '--adapters', root] }
  }
}

async function startAndRead(
  manifest: PluginManifest
): Promise<{ props: EngineProps; view: AdapterProofEngineSnapshot }> {
  const startedAt = Date.now()
  await hotSwap(manifest)
  const [props, memory] = await Promise.all([
    requestSidecar(manifest.id, '/props').then(readEngineProps),
    vramUsedMb()
  ])
  return { props, view: snapshot(startedAt, props, memory) }
}

function fixedRequest(props: EngineProps, adapter = ''): GenerateRequest {
  const turbo = props.turbo
  return {
    prompt: 'instrumental compatibility reference, short neutral rhythm',
    durationSec: PROOF_DURATION_SEC,
    preset: 'turbo-validated',
    seed: PROOF_SEED,
    config: {
      steps: turbo?.inferenceSteps ?? 8,
      guidance: turbo?.guidanceScale ?? 1,
      shift: turbo?.shift ?? 3,
      solver: props.defaultSolver,
      temperature: props.defaultTemperature,
      rewritePrompt: props.defaultRewritePrompt,
      autoLyrics: false,
      lmModel: props.defaultLmModel,
      synthModel: props.defaultSynthModel,
      timeSignature: props.defaultTimeSignature,
      adapterScale: props.defaultAdapterScale,
      lmSeed: PROOF_LM_SEED,
      ...(adapter ? { adapter } : {})
    }
  }
}

async function generateProofAudio(
  folder: string,
  id: string,
  request: GenerateRequest,
  blueprint?: string
): Promise<{ id: string; sha256: string; blueprint?: string }> {
  let audioSha256 = ''
  const client = createEngineClient({
    fetch: (path, init) => requestSidecar(ENGINE_ID, path, init),
    writeWav: async (_jobId, bytes) => {
      const file = join(folder, `${id}.wav`)
      await writeFile(file, bytes, { flag: 'wx' })
      audioSha256 = createHash('sha256').update(bytes).digest('hex')
      return { trackId: id }
    }
  })
  const job = client.generate(request, { id: ENGINE_ID, version: ENGINE_VERSION }, blueprint)
  const result = await client.settled(job.jobId)
  if (result?.status !== 'done' || !audioSha256) {
    throw new Error(result?.error?.message ?? 'The proof audio job did not finish')
  }
  return { id, sha256: audioSha256, blueprint: client.blueprint(job.jobId) }
}

function proofFolder(proofId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(proofId)) throw new Error('proof identity is invalid')
  return join(heavyDataRoot(), 'engine-compatibility', proofId)
}

async function writeProofRecord(proofId: string, record: unknown): Promise<void> {
  const folder = proofFolder(proofId)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'proof.json'), JSON.stringify(record, null, 2), 'utf8')
}

// Best effort: the original error is what the caller needs to see.
async function writeFailedProof(proofId: string, adapterId: string, error: unknown) {
  await writeProofRecord(proofId, {
    proofId,
    completedAt: Date.now(),
    outcome: 'failed',
    error: errorMessage(error),
    adapterId
  }).catch(ignoreFailure)
}

export async function revealAdapterCompatibilityProof(proofId: string): Promise<void> {
  const { shell } = await import('electron')
  shell.showItemInFolder(join(proofFolder(proofId), 'audio', 'A.wav'))
}

async function confirm(owner: BrowserWindow | null): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    title: 'Run engine compatibility proof',
    message: 'This temporarily restarts the local ACE-Step engine and uses GPU memory.',
    detail:
      'Iblis will test one acknowledged adapter-library record against the exact active engine pack. Create is paused while the empty-root and adapter-root checks run. This does not enable the adapter for generation or upload any result.',
    buttons: ['Cancel', 'Run compatibility proof'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  }
  const response = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return response.response === 1
}

async function verifiedExecutableHash(active: ActiveEngine): Promise<string> {
  const executable = join(versionDir(ENGINE_ID, ENGINE_VERSION), ENGINE_BIN)
  const actualHash = await sha256File(executable, active.executableBytes)
  if (actualHash !== active.executableSha256) {
    throw new Error('The installed ACE-Step executable does not match the signed manifest')
  }
  return actualHash
}

// Off then on, same seeds, with the off run's LM blueprint replayed for the on
// run so only the adapter differs. Which one is labelled A is randomized.
async function generateComparison(
  active: ActiveEngine,
  roots: { empty: string; adapters: string; audio: string },
  emptyProps: EngineProps,
  loadedProps: EngineProps,
  selectedAdapter: string
): Promise<AdapterCompatibilityProof['audio']> {
  await hotSwap(manifestWithAdapterRoot(active, roots.empty))
  const offFirst = randomInt(2) === 0
  const off = await generateProofAudio(roots.audio, offFirst ? 'A' : 'B', fixedRequest(emptyProps))
  if (!off.blueprint)
    throw new Error('The empty-root comparison did not return a reusable LM blueprint')
  await hotSwap(manifestWithAdapterRoot(active, roots.adapters))
  const on = await generateProofAudio(
    roots.audio,
    offFirst ? 'B' : 'A',
    fixedRequest(loadedProps, selectedAdapter),
    off.blueprint
  )
  return offFirst
    ? { firstId: off.id, firstSha256: off.sha256, secondId: on.id, secondSha256: on.sha256 }
    : { firstId: on.id, firstSha256: on.sha256, secondId: off.id, secondSha256: off.sha256 }
}

export async function runAdapterCompatibilityProof(
  owner: BrowserWindow | null,
  adapterId: string,
  send: Progress
): Promise<AdapterCompatibilityProof | null> {
  if (!(await confirm(owner))) return null
  const proofId = randomUUID()
  let release: (() => Promise<void>) | undefined
  let active: ActiveEngine | undefined
  let temporary = ''
  let restored = false
  try {
    progress(send, 'validating', 'Verifying the managed adapter and exact ACE-Step pack…')
    release = await resourceCoordinator().beginEngineMutation()
    active = activeEngine()
    const actualHash = await verifiedExecutableHash(active)

    progress(send, 'help', 'Capturing the exact engine help output…')
    const help = await captureHelp(active)
    temporary = await mkdtemp(join(heavyDataRoot(), 'adapter-proof-'))
    const emptyRoot = join(temporary, 'empty')
    const adapterRoot = join(temporary, 'adapters')
    const audioRoot = join(proofFolder(proofId), 'audio')
    await Promise.all([mkdir(emptyRoot), mkdir(adapterRoot), mkdir(audioRoot, { recursive: true })])
    const adapter = await copyAdapterForCompatibilityProof(adapterId, adapterRoot)

    progress(send, 'empty-engine', 'Starting the signed engine with an empty adapter root…')
    const emptyRun = await startAndRead(manifestWithAdapterRoot(active, emptyRoot))

    progress(send, 'adapter-engine', 'Restarting the signed engine with the verified adapter copy…')
    const loadedRun = await startAndRead(manifestWithAdapterRoot(active, adapterRoot))
    const selectedAdapter = loadedRun.props.adapters[0]
    if (!selectedAdapter || loadedRun.props.adapters.length !== 1) {
      throw new Error('The engine did not expose exactly one adapter from the temporary proof root')
    }

    progress(send, 'comparison', 'Generating the fixed same-seed off/on comparison…')
    const audio = await generateComparison(
      active,
      { empty: emptyRoot, adapters: adapterRoot, audio: audioRoot },
      emptyRun.props,
      loadedRun.props,
      selectedAdapter
    )

    progress(send, 'restoring', 'Restoring the ordinary signed engine…')
    await hotSwap(active.manifest)
    restored = true
    const proof: AdapterCompatibilityProof = {
      proofId,
      completedAt: Date.now(),
      adapter: { id: adapter.id, sha256: adapter.sha256, format: adapter.format },
      engine: {
        id: ENGINE_ID,
        version: ENGINE_VERSION,
        executableSha256: actualHash,
        help,
        ordinaryEngineRestored: restored
      },
      empty: emptyRun.view,
      loaded: loadedRun.view,
      selectedAdapter,
      audio
    }
    await writeProofRecord(proofId, proof)
    progress(send, 'complete', 'Compatibility proof completed and was saved locally.')
    return proof
  } catch (error) {
    await writeFailedProof(proofId, adapterId, error)
    throw error
  } finally {
    if (active && !restored) {
      progress(send, 'restoring', 'Restoring the ordinary signed engine…')
      await hotSwap(active.manifest).catch(ignoreFailure)
    }
    await rm(temporary, { recursive: true, force: true }).catch(ignoreFailure)
    await release?.().catch(ignoreFailure)
  }
}
