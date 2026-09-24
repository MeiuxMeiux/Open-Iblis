// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared training-arc types: the resource lock every surface renders, the
// training-pack install state, and the hardware preflight report. Decision
// context: docs/training/00-overview.md (D4 8 GB floor + warning, D8 estimate
// calibration deferred to Jack's first real run).

type ResourceStateName = 'idle' | 'generating' | 'training' | 'engine-mutation'

// One snapshot streamed over resource:state so Create, Training, and the
// player bar all render the same truth. detail is finished copy — banners
// show it verbatim instead of mapping codes.
export interface ResourceState {
  state: ResourceStateName
  detail: string | null
  since: number
}

export const GENERATION_PAUSED_WHILE_TRAINING = 'Generation is paused while a training runs.'
export const TRAINING_LOCKS_GENERATION = 'Training locks generation until it finishes.'
export const TRAINING_BLOCKED_BY_QUEUE =
  'Training waits until the generation queue is empty. Finish, cancel, or clear queued takes first.'
export const TRAINING_ALREADY_RUNNING = 'A training is already running.'
export const ENGINE_CHANGE_IN_PROGRESS = 'An engine change is in progress.'

export interface TrainingPackState {
  installed: boolean
  version: string | null
}

export type PreflightStatus = 'pass' | 'warn' | 'fail'

export interface PreflightRow {
  id: 'gpu' | 'disk' | 'queue' | 'pack'
  label: string
  status: PreflightStatus
  detail: string
}

export interface TrainingPreflightReport {
  rows: PreflightRow[]
  // true when nothing failed; warnings still allow training (D4).
  ok: boolean
  generatedAt: number
}

// D4 (revised 2026-07-14): 8 GB VRAM is a supported, first-class configuration
// for training (Jack's call — the upstream "16 GB minimum" is conservative).
// The hard floor sits at 6 GB so that every genuine 8 GB card clears it even
// when nvidia-smi reports total slightly under 8192 (laptop/reserved memory),
// and only cards small enough to certainly OOM are refused. 8-16 GB trains
// with an honest "memory is tight, runs are long" warning. The scratch
// estimate is an upstream-derived guess until the first real run calibrates
// it (D8).
export const VRAM_FLOOR_MB = 6144
export const VRAM_COMFORTABLE_MB = 16384
export const SCRATCH_BYTES_PER_TRACK_ESTIMATE = 1.25 * 1024 * 1024 * 1024
export const DEFAULT_PREFLIGHT_TRACK_COUNT = 10

// Hard stop from the ratified design (docs/training/01); its soft
// under-8 / over-50 warnings are not implemented yet.
export const MAX_TRACKS_HARD_STOP = 200

export const TRAINING_CATEGORIES = ['texture', 'groove'] as const
export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number]

// Public name rules mirrored from the server (3-40 chars, lowercase). Private
// trainings use the same rules so a later publish keeps the name valid.
export const TRAINING_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/

// D2 as amended by D-O2 (docs/training/00-overview.md): a training publishes
// to the community library only when this install may use community Styles
// (a live key and a configured trainings service). Otherwise it is private:
// it never contacts the trainings service and ends in the local Styles
// library. Stored on every job and every resulting Style so a later
// "publish" action can find private trainings.
export type TrainingVisibility = 'private' | 'community'

export const PRIVATE_TRAINING_NOTE =
  'This training stays on this machine. A product key lets you publish it to community Styles.'

export type TrainingStageName =
  | 'scan'
  | 'stems'
  | 'tag'
  | 'dataset'
  | 'train-texture'
  | 'train-groove'
  | 'export'
  | 'upload'
  | 'pulldown'
  // Private trainings only: add the exported style to the local library.
  | 'register'

type TrainingStageStatus = 'queued' | 'active' | 'done' | 'failed' | 'skipped'

export interface TrainingStageRecord {
  name: TrainingStageName
  status: TrainingStageStatus
  percent: number
  detail?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

// D2: both acknowledgements are explicit, timestamped, and echoed into the
// upload metadata. Using Training is the opt-in. A private training never
// uploads, so it records only the rights attestation (public upload = null).
interface TrainingConsentRecord {
  publicUploadAcknowledgedAt: number | null
  rightsAttestedAt: number
}

interface TrainingArtifact {
  category: TrainingCategory
  fileName: string
  bytes: number
  sha256: string
}

// 'saved' is the terminal state of a private training: registered in the
// local Styles library, never uploaded. 'live' is a published one.
export type TrainingJobStatus =
  | 'running'
  | 'interrupted'
  | 'awaiting-upload'
  | 'uploading'
  | 'live'
  | 'saved'
  | 'failed'
  | 'cancelled'

interface TrainingFolderSummary {
  trackCount: number
  totalDurationSec: number
}

// Power-user training overrides (docs/training/01-training-pack.md "VRAM
// tiers"). Every field is optional: an omitted field keeps the tier's tuned
// default, which the pack picks from the card's VRAM. The sidecar clamps every
// value to a safe range, so these are hints, not a way to wedge the trainer.
export interface TrainingAdvancedSettings {
  rank?: number
  epochs?: number
  batchSize?: number
  gradientAccumulation?: number
  learningRate?: number
  optimizer?: TrainingOptimizer
  precision?: TrainingPrecision
  gradientCheckpointing?: boolean
  offloadEncoder?: boolean
}

// Only adamw and adafactor differ meaningfully in the frozen runtime;
// adamw8bit/prodigy are accepted for forward-compat but fall back to adamw
// (their wheels are not bundled). The UI surfaces only the two that work.
type TrainingOptimizer = 'adamw' | 'adafactor'
type TrainingPrecision = 'auto' | 'bf16' | 'fp16' | 'fp32'

// Clamp bounds mirrored from stages/profile.py so the renderer can validate
// inline (the sidecar re-clamps as the authority).
export const TRAINING_SETTING_BOUNDS = {
  rank: { min: 1, max: 256 },
  epochs: { min: 1, max: 5000 },
  batchSize: { min: 1, max: 8 },
  gradientAccumulation: { min: 1, max: 64 }
} as const

// The tier the pack auto-selects, echoed into the train stage result so
// History can show "trained at rank 16 (8gb tier), adafactor".
interface TrainingResolvedProfile {
  tier: string
  rank: number
  optimizer: string
  precision: string
}

// What the renderer sees per job. The main-process record additionally holds
// the server claim token and the scratch/source paths — never sent here.
export interface TrainingJobView {
  id: string
  name: string
  trainingId: string
  version: number
  categories: TrainingCategory[]
  // Absent only on jobs stored before 0.2.0-alpha.52, which were community.
  visibility?: TrainingVisibility
  folder: TrainingFolderSummary
  consent: TrainingConsentRecord
  stages: TrainingStageRecord[]
  artifacts: TrainingArtifact[]
  status: TrainingJobStatus
  serverStatus?: string
  error?: string
  // The advanced overrides this job launched with (absent = full auto).
  advanced?: TrainingAdvancedSettings
  // What the pack actually trained at, per category, once a train stage runs.
  profiles?: Partial<Record<TrainingCategory, TrainingResolvedProfile>>
  createdAt: number
  updatedAt: number
}

export interface TrainingProgressEvent {
  jobId: string
  stage: TrainingStageName
  percent: number
  detail: string
}

// Wizard step 1-2 result: the folder stays main-side behind an opaque token.
export interface TrainingScanResult {
  folderToken: string
  folderName: string
  trackCount: number
  totalDurationSec: number
  skipped: { name: string; reason: string }[]
  preflight: TrainingPreflightReport
  // Total VRAM (MB) or null; lets the wizard preview the auto-selected tier.
  vramTotalMb: number | null
}

// UI-side mirror of stages/profile.py tiers (the pack is the authority). Lets
// the wizard show "16 GB tier — rank 64, AdamW" without a round trip. Keep the
// thresholds and values in lockstep with profile.py when either changes.
export interface TrainingTierPreview {
  tier: string
  label: string
  rank: number
  optimizer: TrainingOptimizer
  offloadEncoder: boolean
}

export function resolveTierPreview(vramTotalMb: number | null): TrainingTierPreview {
  const mb = typeof vramTotalMb === 'number' && vramTotalMb > 0 ? vramTotalMb : 0
  if (mb === 0 || mb < 10240) {
    return { tier: '8gb', label: '8 GB', rank: 16, optimizer: 'adafactor', offloadEncoder: true }
  }
  if (mb < 16384) {
    return { tier: '12gb', label: '12 GB', rank: 32, optimizer: 'adamw', offloadEncoder: true }
  }
  if (mb < 24576) {
    return { tier: '16gb', label: '16 GB', rank: 64, optimizer: 'adamw', offloadEncoder: false }
  }
  return { tier: '24gb', label: '24 GB+', rank: 128, optimizer: 'adamw', offloadEncoder: false }
}

export interface TrainingReserveResult {
  available: boolean
  // Decided by main from the licensing state; the renderer only displays it.
  visibility?: TrainingVisibility
  trainingId?: string
  version?: number
  message?: string
}

export interface TrainingStartInput {
  folderToken: string
  name: string
  trainingId: string
  version: number
  categories: TrainingCategory[]
  // The renderer confirms the switches were flipped; main stamps the times.
  // Public upload is required only for a community training.
  publicUploadAcknowledged: boolean
  rightsAttested: boolean
  // Optional power-user overrides; omitted keys stay on the VRAM-tier auto.
  advanced?: TrainingAdvancedSettings
}
