// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Pure training-preflight evaluation. Probes come in, honest pass/warn/fail
// rows come out; no Electron, no I/O, fully unit-testable. Thresholds are D4
// (8 GB floor + warning band); scratch numbers are upstream-derived estimates
// until Jack's first real run calibrates them (D8).

import {
  DEFAULT_PREFLIGHT_TRACK_COUNT,
  SCRATCH_BYTES_PER_TRACK_ESTIMATE,
  VRAM_COMFORTABLE_MB,
  VRAM_FLOOR_MB,
  type PreflightRow,
  type TrainingPreflightReport
} from '../../../shared/training'

export interface PreflightFacts {
  vramTotalMb: number | null
  freeDiskBytes: number | null
  queueBusy: boolean
  packInstalled: boolean
  // Track count once a folder is scanned; the skeleton preflight estimates
  // for a typical run instead.
  trackCount?: number
}

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function gpuRow(vramTotalMb: number | null): PreflightRow {
  if (vramTotalMb === null) {
    return {
      id: 'gpu',
      label: 'GPU memory',
      status: 'fail',
      detail:
        'Could not measure GPU memory. Training needs an NVIDIA GPU with CUDA drivers; 8 GB of VRAM or more is recommended (nvidia-smi returned nothing).'
    }
  }
  if (vramTotalMb < VRAM_FLOOR_MB) {
    return {
      id: 'gpu',
      label: 'GPU memory',
      status: 'fail',
      detail: `This GPU reports ${Math.round(vramTotalMb / 1024)} GB of VRAM, which is too little to train without running out of memory. 8 GB or more is recommended.`
    }
  }
  if (vramTotalMb < VRAM_COMFORTABLE_MB) {
    return {
      id: 'gpu',
      label: 'GPU memory',
      status: 'warn',
      detail: `${Math.round(vramTotalMb / 1024)} GB of VRAM is a supported setup, but memory will be tight and runs will take long. Low-VRAM settings are used by default. Time estimates are uncalibrated until your first run completes.`
    }
  }
  return {
    id: 'gpu',
    label: 'GPU memory',
    status: 'pass',
    detail: `${Math.round(vramTotalMb / 1024)} GB of VRAM available.`
  }
}

function diskRow(freeBytes: number | null, scratchEstimate: number): PreflightRow {
  if (freeBytes === null) {
    return {
      id: 'disk',
      label: 'Scratch disk space',
      status: 'warn',
      detail: 'Could not measure free disk space. Training may stop if the disk fills.'
    }
  }
  if (freeBytes < scratchEstimate) {
    return {
      id: 'disk',
      label: 'Scratch disk space',
      status: 'fail',
      detail: `Training needs about ${gib(scratchEstimate)} of scratch space, and ${gib(freeBytes)} is free. Free up disk space first. The estimate is calibrated after your first run.`
    }
  }
  return {
    id: 'disk',
    label: 'Scratch disk space',
    status: 'pass',
    detail: `About ${gib(scratchEstimate)} of scratch space is needed; ${gib(freeBytes)} is free.`
  }
}

export function evaluateTrainingPreflight(
  facts: PreflightFacts,
  now: number = Date.now()
): TrainingPreflightReport {
  const tracks = facts.trackCount ?? DEFAULT_PREFLIGHT_TRACK_COUNT
  const scratchEstimate = Math.ceil(tracks * SCRATCH_BYTES_PER_TRACK_ESTIMATE)
  const rows: PreflightRow[] = [
    gpuRow(facts.vramTotalMb),
    diskRow(facts.freeDiskBytes, scratchEstimate),
    facts.queueBusy
      ? {
          id: 'queue',
          label: 'Generation queue',
          status: 'fail',
          detail:
            'The generation queue has work. Training never cancels your takes — finish, cancel, or clear them first.'
        }
      : {
          id: 'queue',
          label: 'Generation queue',
          status: 'pass',
          detail: 'The generation queue is empty. Generation pauses while a training runs.'
        },
    facts.packInstalled
      ? {
          id: 'pack',
          label: 'Training pack',
          status: 'pass',
          detail: 'The training pack is installed.'
        }
      : {
          id: 'pack',
          label: 'Training pack',
          status: 'fail',
          detail: 'Training needs the training pack. Install it from this page first.'
        }
  ]
  return { rows, ok: rows.every((row) => row.status !== 'fail'), generatedAt: now }
}
