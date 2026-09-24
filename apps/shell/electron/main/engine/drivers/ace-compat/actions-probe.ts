// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Audio-conditioning spike (roadmap-to-beta C.2, creation-actions.md slice 1).
//
// Proves — against the exact installed ace-server, on this machine — that the
// repaint task can OUTPAINT: given a source clip and a repaint region beyond
// its end, the engine returns audio that carries the extension. The upstream
// contract is confirmed from source at pin 948b929 (tools/ace-server.cpp
// multipart /synth: parts "request" + "audio"; src/request.h repainting_start/
// repainting_end semantics); what this probe adds is proof that the shipped
// Windows executable honors it. The LM phase is skipped for repaint, so the
// probe is a single multipart /synth round-trip.
//
// The source clip is synthesized in-process (deterministic tones) — no user
// audio, no rights questions, nothing leaves localhost. Pass here is the gate
// for building the user-facing Extend flow; the audible continuity judgment
// stays with the human running it.

import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EngineActionsProbeEvidence } from '../../../../../shared/engine-actions'
import { EngineError, carveWav, parseJobId, isTerminalFailure } from './protocol'
import type { SidecarFetch } from './transport'
import { heavyDataRoot } from '../../../storage'
import { ignoreFailure } from '../../../ignore-failure'

export const PROBE_SOURCE_SEC = 6
export const PROBE_EXTEND_SEC = 4
const PROBE_TOLERANCE_SEC = 1.5
const PROBE_SEED = 727_565_403
const PROBE_SAMPLE_RATE = 48_000
const PROBE_TIMEOUT_MS = 10 * 60_000
const POLL_INTERVAL_MS = 1000
const BOUNDARY = 'iblis-actions-probe-3c1f9a'
const EVIDENCE_FILE = 'engine-actions-probe.json'
const MEDIA_DIRECTORY = 'engine-actions-probe'
const SOURCE_FILE = 'source.wav'
const RESULT_FILE = 'result.wav'

export type ActionsProbeMediaKind = 'source' | 'result'

export function actionsProbeMediaPath(kind: ActionsProbeMediaKind): string {
  return join(heavyDataRoot(), MEDIA_DIRECTORY, kind === 'source' ? SOURCE_FILE : RESULT_FILE)
}

// A plain tonal source: four-note arpeggio repeated, per-note fade so the
// waveform is obviously musical structure rather than noise. Deterministic —
// same bytes every run, so evidence stays comparable across engine versions.
export function probeSourceWav(): Buffer {
  const frames = PROBE_SOURCE_SEC * PROBE_SAMPLE_RATE
  const notesHz = [220, 261.63, 329.63, 440]
  const noteFrames = PROBE_SAMPLE_RATE / 2 // eighth-note feel at 120 BPM
  const pcm = Buffer.alloc(frames * 2 * 2) // stereo, 16-bit
  for (let i = 0; i < frames; i++) {
    const note = Math.floor(i / noteFrames) % notesHz.length
    const t = i / PROBE_SAMPLE_RATE
    const inNote = (i % noteFrames) / noteFrames
    const envelope = Math.min(1, inNote * 12) * (1 - inNote * 0.7)
    const hz = notesHz[note] ?? 0
    const sample = Math.round(Math.sin(2 * Math.PI * hz * t) * envelope * 0.5 * 32767)
    pcm.writeInt16LE(sample, i * 4)
    pcm.writeInt16LE(sample, i * 4 + 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(2, 22) // stereo
  header.writeUInt32LE(PROBE_SAMPLE_RATE, 24)
  header.writeUInt32LE(PROBE_SAMPLE_RATE * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// The repaint request: region [source end, source end + extension] is fully
// outside the source, which upstream defines as outpainting after it. Steps/
// guidance/shift are omitted so the engine auto-resolves per model family;
// caption/lyrics pass verbatim to the DiT (LM is skipped for repaint).
export function probeRequestJson(): Record<string, unknown> {
  return {
    caption: 'warm analog synthesizer arpeggio, steady tempo, clean mix',
    lyrics: '[Instrumental]',
    task_type: 'repaint',
    repainting_start: PROBE_SOURCE_SEC,
    repainting_end: PROBE_SOURCE_SEC + PROBE_EXTEND_SEC,
    seed: PROBE_SEED,
    output_format: 'wav32'
  }
}

export interface MultipartPart {
  name: string
  filename?: string
  contentType: string
  data: Buffer
}

// Minimal multipart/form-data encoder (Node's fetch FormData does not take
// Buffers without a File polyfill dance, and the parts here are tiny).
export function multipartFormData(
  parts: MultipartPart[],
  boundary: string = BOUNDARY
): { contentType: string; body: Buffer } {
  const chunks: Buffer[] = []
  for (const part of parts) {
    const disposition =
      `Content-Disposition: form-data; name="${part.name}"` +
      (part.filename ? `; filename="${part.filename}"` : '')
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n${disposition}\r\nContent-Type: ${part.contentType}\r\n\r\n`,
        'latin1'
      ),
      part.data,
      Buffer.from('\r\n', 'latin1')
    )
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'))
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks)
  }
}

export interface ActionsProbeDeps {
  fetch: SidecarFetch
  engineId: string
  engineVersion: string | null
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  persist?: (
    evidence: EngineActionsProbeEvidence,
    media: { source: Buffer; result: Buffer }
  ) => Promise<void>
}

export interface ActionsProbeOperationDeps {
  beginMutation(): Promise<() => Promise<void>>
  engineId(): string | null
  engineVersion(id: string): string | null
  run(id: string, version: string | null): Promise<EngineActionsProbeEvidence>
}

// The empty-queue inhibition is acquired before engine resolution and held
// until the probe has polled, validated, and persisted its evidence. This
// closes both directions of the admission race: queued/running work refuses
// the probe, and new generation cannot enter while the probe owns the engine.
export async function runActionsProbeWithLease(
  deps: ActionsProbeOperationDeps
): Promise<EngineActionsProbeEvidence> {
  const release = await deps.beginMutation()
  try {
    const engineId = deps.engineId()
    if (!engineId) throw new Error('No engine is installed')
    return await deps.run(engineId, deps.engineVersion(engineId))
  } finally {
    await release().catch(ignoreFailure)
  }
}

export async function runActionsProbe(deps: ActionsProbeDeps): Promise<EngineActionsProbeEvidence> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const startedAt = now()
  const deadline = startedAt + PROBE_TIMEOUT_MS

  const { contentType, body } = multipartFormData([
    {
      name: 'request',
      contentType: 'application/json',
      data: Buffer.from(JSON.stringify(probeRequestJson()), 'utf8')
    },
    {
      name: 'audio',
      filename: 'probe-source.wav',
      contentType: 'audio/wav',
      data: probeSourceWav()
    }
  ])

  const post = await deps.fetch('/synth', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(body)
  })
  if (!post.ok) throw new EngineError('post_failed', `/synth -> HTTP ${post.status}`)
  const id = encodeURIComponent(parseJobId(await post.json()))

  let bytes: Buffer | null = null
  while (now() < deadline) {
    const result = await deps.fetch(`/job?id=${id}&result=1`, {})
    if (result.status === 200) {
      const candidate = Buffer.from(await result.arrayBuffer())
      if (candidate.length > 0) {
        bytes = candidate
        break
      }
    }
    const st = await deps.fetch(`/job?id=${id}`, {})
    if (st.ok) {
      const status = ((await st.json().catch(() => null)) as { status?: string } | null)?.status
      if (isTerminalFailure(status)) {
        throw new EngineError('probe_failed', `repaint probe job ${status}`)
      }
    }
    await sleep(POLL_INTERVAL_MS)
  }
  if (!bytes) throw new EngineError('timeout', 'repaint probe timed out')

  const wav = carveWav(bytes)
  const outputSec = wav.metadata.durationSec
  const expectedSec = PROBE_SOURCE_SEC + PROBE_EXTEND_SEC
  const passed = Math.abs(outputSec - expectedSec) <= PROBE_TOLERANCE_SEC
  const evidence: EngineActionsProbeEvidence = {
    ranAt: startedAt,
    engineId: deps.engineId,
    engineVersion: deps.engineVersion,
    task: 'repaint-extend',
    sourceSec: PROBE_SOURCE_SEC,
    requestedExtendSec: PROBE_EXTEND_SEC,
    outputSec,
    toleranceSec: PROBE_TOLERANCE_SEC,
    elapsedMs: now() - startedAt,
    passed,
    mediaAvailable: true,
    note: passed
      ? 'The engine returned an outpainted take of the expected length. Listen for continuity across the source boundary before building the Extend flow.'
      : `Expected about ${expectedSec}s of audio, got ${outputSec.toFixed(2)}s. The shipped executable did not honor the outpaint region — do not build Extend on this engine version.`
  }
  await (deps.persist ?? persistEvidence)(evidence, {
    source: probeSourceWav(),
    result: wav.bytes
  })
  return evidence
}

function evidencePath(): string {
  return join(heavyDataRoot(), EVIDENCE_FILE)
}

async function atomicWrite(file: string, contents: Buffer | string): Promise<void> {
  const temporary = `${file}.tmp`
  await writeFile(temporary, contents)
  await rename(temporary, file)
}

async function persistEvidence(
  evidence: EngineActionsProbeEvidence,
  media: { source: Buffer; result: Buffer }
): Promise<void> {
  await mkdir(join(heavyDataRoot(), MEDIA_DIRECTORY), { recursive: true })
  await atomicWrite(actionsProbeMediaPath('source'), media.source)
  await atomicWrite(actionsProbeMediaPath('result'), media.result)
  await atomicWrite(evidencePath(), JSON.stringify(evidence, null, 2))
}

async function hasProbeMedia(): Promise<boolean> {
  try {
    await Promise.all([
      access(actionsProbeMediaPath('source')),
      access(actionsProbeMediaPath('result'))
    ])
    return true
  } catch {
    return false
  }
}

export async function readActionsEvidence(): Promise<EngineActionsProbeEvidence | null> {
  try {
    const parsed = JSON.parse(await readFile(evidencePath(), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const shape = parsed as { task?: unknown; passed?: unknown }
    if (shape.task !== 'repaint-extend' || typeof shape.passed !== 'boolean') return null
    const record = parsed as EngineActionsProbeEvidence
    return { ...record, mediaAvailable: record.mediaAvailable === true && (await hasProbeMedia()) }
  } catch {
    return null
  }
}
