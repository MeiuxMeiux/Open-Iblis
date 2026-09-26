// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Staged-output validation and atomic promotion of a stem set, plus reads of
// promoted sets. Layout inside a track folder (the master is never touched):
//
//   <track>/stems/.staging/<jobId>/   fresh, empty, handed to the processor
//   <track>/stems/<setId>/            promoted: <role>.wav files + set.v1.json
//
// Promotion is one rename of the staging folder, so a set is either complete
// or absent. Everything the processor reported is re-derived here from the
// bytes: facts, levels, hashes. Its own numbers are kept only as diagnostics.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  isStemRole,
  isTransformJobId,
  type StemMetricsV2,
  type StemOutputV2,
  type StemRole
} from '@iblis/plugin-sdk'
import type { StemFileView, StemSetView } from '../../../shared/stems'
import { stemModelFacts } from '../../../shared/stems'
import type { StemMeasurement } from './measure'

const STAGING_DIR = '.staging'
const RECORD = 'set.v1.json'
const MAX_STEM_BYTES = 512 * 1024 * 1024
const DURATION_TOLERANCE_SEC = 0.05

interface StemFileRecord extends StemFileView {
  file: string
  sha256: string
  sampleRateHz: number
  channels: number
  frames: number
}

export interface StemSetRecordV1 extends Omit<StemSetView, 'stems'> {
  schema: 1
  trackId: string
  sourceSha256: string
  files: StemFileRecord[]
}

export interface PromoteInput {
  trackDir: string
  trackId: string
  jobId: string
  sourceSha256: string
  source: { sampleRateHz: number; durationSec: number }
  outputs: StemOutputV2[]
  metrics: StemMetricsV2
  provider: { id: string; name: string; version: string; model: string }
  backend: string
  notice?: string
  measure: (files: { role: StemRole; path: string }[]) => Promise<StemMeasurement[]>
  now?: () => number
}

function stagingPath(trackDir: string, jobId: string): string {
  if (!isTransformJobId(jobId)) throw new Error('invalid stem job id')
  return join(trackDir, 'stems', STAGING_DIR, jobId)
}

export async function createStaging(trackDir: string, jobId: string): Promise<string> {
  const dir = stagingPath(trackDir, jobId)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  return realpath(dir)
}

export async function discardStaging(trackDir: string, jobId?: string): Promise<void> {
  const target = jobId ? stagingPath(trackDir, jobId) : join(trackDir, 'stems', STAGING_DIR)
  await rm(target, { recursive: true, force: true })
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

// Exactly the declared files, each a plain regular file of sane size.
async function checkStagedEntries(dir: string, outputs: StemOutputV2[]): Promise<void> {
  const expected = new Set(outputs.map((o) => o.path))
  const entries = await readdir(dir)
  for (const name of entries) {
    if (!expected.has(name)) throw new Error('processor wrote an undeclared file')
  }
  for (const name of expected) {
    const info = await lstat(join(dir, name)).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error('declared stem file is missing')
    if (info.size < 45 || info.size > MAX_STEM_BYTES)
      throw new Error('stem file size is out of range')
  }
}

function checkFacts(m: StemMeasurement, source: PromoteInput['source']): void {
  if (m.sampleRateHz !== source.sampleRateHz)
    throw new Error('stem sample rate differs from the track')
  if (m.channels < 1 || m.channels > 2) throw new Error('stem channel count is unsupported')
  if (Math.abs(m.durationSec - source.durationSec) > DURATION_TOLERANCE_SEC) {
    throw new Error('stem duration differs from the track')
  }
}

export async function promoteStemSet(input: PromoteInput): Promise<StemSetRecordV1> {
  const dir = stagingPath(input.trackDir, input.jobId)
  await checkStagedEntries(dir, input.outputs)
  const files = input.outputs.map((o) => ({ role: o.role, path: join(dir, o.path) }))
  const measured = await input.measure(files)
  const records: StemFileRecord[] = []
  for (const output of input.outputs) {
    const m = measured.find((candidate) => candidate.role === output.role)
    if (!m) throw new Error('stem measurement is missing')
    checkFacts(m, input.source)
    const path = join(dir, output.path)
    records.push({
      role: output.role,
      file: output.path,
      sha256: await sha256(path),
      bytes: (await lstat(path)).size,
      sampleRateHz: m.sampleRateHz,
      channels: m.channels,
      frames: m.frames,
      durationSec: m.durationSec,
      peakDb: m.peakDb,
      rmsDb: m.rmsDb,
      silent: m.silent,
      peaks: m.peaks,
      measured: m.measured
    })
  }
  const record: StemSetRecordV1 = {
    schema: 1,
    id: input.jobId,
    trackId: input.trackId,
    createdAt: (input.now ?? Date.now)(),
    sourceSha256: input.sourceSha256,
    providerId: input.provider.id,
    providerName: input.provider.name,
    providerVersion: input.provider.version,
    model: input.provider.model,
    modelLabel: stemModelFacts(input.provider.model).label,
    backend: input.backend,
    ...(input.notice ? { notice: input.notice } : {}),
    computeMs: input.metrics.computeMs,
    residualDb: input.metrics.residualDb,
    files: sortRoles(records)
  }
  await writeFile(join(dir, RECORD), JSON.stringify(record, null, 2), 'utf8')
  await rename(dir, join(input.trackDir, 'stems', input.jobId))
  return record
}

const ROLE_ORDER: StemRole[] = [
  'stem.vocals',
  'stem.drums',
  'stem.bass',
  'stem.other',
  'stem.guitar',
  'stem.piano'
]

function sortRoles<T extends { role: StemRole }>(items: T[]): T[] {
  return [...items].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
}

function validRecord(value: unknown, setId: string, trackId: string): value is StemSetRecordV1 {
  const r = value as Partial<StemSetRecordV1> | null
  return (
    r?.schema === 1 &&
    r.id === setId &&
    r.trackId === trackId &&
    Array.isArray(r.files) &&
    r.files.length > 0 &&
    r.files.every(
      (f) =>
        isStemRole(f.role) &&
        typeof f.file === 'string' &&
        /^[a-z][a-z0-9_-]{0,31}\.wav$/.test(f.file)
    )
  )
}

export async function readStemSets(trackDir: string, trackId: string): Promise<StemSetRecordV1[]> {
  const root = join(trackDir, 'stems')
  const names = await readdir(root).catch(() => [] as string[])
  const sets: StemSetRecordV1[] = []
  for (const name of names) {
    if (name.startsWith('.') || !isTransformJobId(name)) continue
    const info = await lstat(join(root, name)).catch(() => null)
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    try {
      const parsed: unknown = JSON.parse(await readFile(join(root, name, RECORD), 'utf8'))
      if (validRecord(parsed, name, trackId)) sets.push(parsed)
    } catch {
      // An unreadable record hides its set rather than failing the track.
    }
  }
  return sets.sort((a, b) => b.createdAt - a.createdAt)
}

export function toStemSetView(record: StemSetRecordV1): StemSetView {
  return {
    id: record.id,
    createdAt: record.createdAt,
    providerId: record.providerId,
    providerName: record.providerName,
    providerVersion: record.providerVersion,
    model: record.model,
    modelLabel: record.modelLabel,
    backend: record.backend,
    ...(record.notice ? { notice: record.notice } : {}),
    computeMs: record.computeMs,
    residualDb: record.residualDb,
    stems: record.files.map((f) => ({
      role: f.role,
      peakDb: f.peakDb,
      rmsDb: f.rmsDb,
      durationSec: f.durationSec,
      bytes: f.bytes,
      peaks: f.peaks,
      silent: f.silent,
      measured: f.measured
    }))
  }
}

// Main-only: resolve one promoted stem file, refusing links and escapes.
export async function stemFilePath(
  trackDir: string,
  trackId: string,
  setId: string,
  role: StemRole
): Promise<string | null> {
  if (!isTransformJobId(setId) || !isStemRole(role)) return null
  const record = (await readStemSets(trackDir, trackId)).find((set) => set.id === setId)
  const file = record?.files.find((f) => f.role === role)
  if (!file) return null
  const path = join(trackDir, 'stems', setId, file.file)
  const info = await lstat(path).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink()) return null
  return path
}

export async function stemSetDirectory(
  trackDir: string,
  trackId: string,
  setId: string
): Promise<string | null> {
  if (!isTransformJobId(setId)) return null
  const exists = (await readStemSets(trackDir, trackId)).some((set) => set.id === setId)
  return exists ? join(trackDir, 'stems', setId) : null
}
