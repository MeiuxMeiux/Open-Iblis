// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Private trainings (D2 as amended by D-O2, docs/training/00-overview.md): an
// install that may not use community Styles trains locally and keeps the
// result. Nothing here touches the network: the name is checked against the
// server's rules and this machine's own trainings and Styles only.

import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { AdapterImportDetails } from '../../../shared/adapters'
import {
  TRAINING_NAME_PATTERN,
  type TrainingReserveResult,
  type TrainingVisibility
} from '../../../shared/training'
import type { TrainingJobRecord } from './store'

export const NAME_RULES =
  'Names use 3-40 characters: lowercase letters, digits, and hyphens, starting with a letter or digit.'

// Community publishing needs both a trainings endpoint in this build and a
// live lease carrying styles-community. Anything else trains privately.
export function trainingVisibility(
  endpointConfigured: boolean,
  communityLease: string | null
): TrainingVisibility {
  return endpointConfigured && communityLease !== null ? 'community' : 'private'
}

// A library display name belongs to a training name when it is the name
// itself or "<name> (texture|groove)" (upload-flow and registerPrivate).
function styleNameTaken(name: string, styleNames: string[]): boolean {
  return styleNames.some(
    (style) => style === name || style === `${name} (texture)` || style === `${name} (groove)`
  )
}

export function checkPrivateName(
  name: string,
  jobNames: string[],
  styleNames: string[]
): TrainingReserveResult {
  if (!TRAINING_NAME_PATTERN.test(name)) {
    return { available: false, visibility: 'private', message: NAME_RULES }
  }
  if (jobNames.includes(name) || styleNameTaken(name, styleNames)) {
    return {
      available: false,
      visibility: 'private',
      message: 'One of your trainings or styles already uses this name.'
    }
  }
  return {
    available: true,
    visibility: 'private',
    trainingId: `local-${randomBytes(8).toString('hex')}`,
    version: 1
  }
}

// The library import for each exported adapter of a finished private job.
export function privateImports(
  record: TrainingJobRecord,
  acknowledgedAt: number
): { path: string; details: AdapterImportDetails & { acknowledgedAt: number } }[] {
  return record.artifacts.map((artifact) => ({
    path: join(record.scratchDir, 'output', artifact.fileName),
    details: {
      displayName:
        record.artifacts.length > 1 ? `${record.name} (${artifact.category})` : record.name,
      origin: 'yours',
      visibility: 'private',
      trainingId: record.trainingId,
      trainingVersion: record.version,
      claimedBaseModel: 'ACE-Step 1.5',
      acknowledgedAt
    }
  }))
}
