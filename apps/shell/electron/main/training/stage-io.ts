// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// What the pipeline sends to each sidecar stage and how it reads the answer
// back. Split from pipeline.ts so the state machine stays readable; the
// sidecar's JSON is untrusted, so every field is checked before it lands in
// the job record.

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { TrainingCategory, TrainingStageName } from '../../../shared/training'
import type { SidecarScalar } from './sidecar-client'
import type { TrainingJobRecord } from './store'

type HashFile = (path: string) => Promise<{ bytes: number; sha256: string }>

function consentSha256(record: TrainingJobRecord): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: record.name,
        trainingId: record.trainingId,
        publicUploadAcknowledgedAt: record.consent.publicUploadAcknowledgedAt,
        rightsAttestedAt: record.consent.rightsAttestedAt
      })
    )
    .digest('hex')
}

export function stageParams(
  record: TrainingJobRecord,
  stage: TrainingStageName,
  threads: number
): Record<string, unknown> {
  const base = { scratch: record.scratchDir }
  switch (stage) {
    case 'scan':
      return { ...base, source: record.folderPath, ingest: true }
    case 'dataset':
      return { ...base, categories: record.categories }
    case 'train-texture':
    case 'train-groove':
      return {
        ...base,
        category: stage === 'train-texture' ? 'texture' : 'groove',
        threads,
        vramTotalMb: record.vramTotalMb ?? null,
        settings: record.advanced
      }
    case 'export':
      return {
        ...base,
        name: record.name,
        categories: record.categories,
        consentSha256: consentSha256(record)
      }
    default:
      return base
  }
}

function readProfile(record: TrainingJobRecord, stage: TrainingStageName, result: unknown): void {
  const r = result as
    | { tier?: unknown; rank?: SidecarScalar; optimizer?: SidecarScalar; precision?: SidecarScalar }
    | null
    | undefined
  const category = stage === 'train-texture' ? 'texture' : 'groove'
  if (typeof r?.tier !== 'string') return
  record.profiles = {
    ...record.profiles,
    [category]: {
      tier: r.tier,
      rank: Number(r.rank ?? 0),
      optimizer: String(r.optimizer ?? ''),
      precision: String(r.precision ?? '')
    }
  }
}

async function readArtifacts(
  record: TrainingJobRecord,
  result: unknown,
  hashFile: HashFile
): Promise<void> {
  const listed =
    (result as { files?: ({ name?: SidecarScalar } | null)[] | null } | null | undefined)?.files ??
    []
  record.artifacts = []
  for (const file of listed) {
    // Adapters only (metadata.json rides along at upload); fixed name set.
    const match = /^adapter_(texture|groove)\.safetensors$/.exec(String(file?.name ?? ''))
    if (!match) continue
    const category = match[1] as TrainingCategory
    // Never trust sidecar-reported sizes/hashes: measure the real bytes.
    const measured = await hashFile(join(record.scratchDir, 'output', match[0]))
    record.artifacts.push({ category, fileName: match[0], ...measured })
  }
  if (record.artifacts.length === 0) {
    throw new Error('the export stage produced no adapter artifacts')
  }
}

export async function handleStageResult(
  record: TrainingJobRecord,
  stage: TrainingStageName,
  result: unknown,
  hashFile: HashFile
): Promise<void> {
  if (stage === 'train-texture' || stage === 'train-groove') {
    readProfile(record, stage, result)
    return
  }
  if (stage === 'scan') {
    const summary = result as { trackCount?: unknown; totalDurationSec?: number } | null | undefined
    if (typeof summary?.trackCount === 'number') {
      record.folder = {
        trackCount: summary.trackCount,
        totalDurationSec: Math.round(summary.totalDurationSec ?? 0)
      }
    }
    return
  }
  if (stage === 'export') await readArtifacts(record, result, hashFile)
}
