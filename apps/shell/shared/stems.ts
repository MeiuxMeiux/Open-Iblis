// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CanonicalKeyPitchClass, KeyMode, StemBackend, StemRole } from '@iblis/plugin-sdk'
import type { IpcResult } from './contract'

// Renderer-safe stem metadata. No path, executable, or provider-defined JSON
// crosses the bridge: stems are addressed as iblis-stem://<track>/<set>/<role>.

type StemJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface StemProviderView {
  id: string
  name: string
  version: string
  model: string
  label: string
  description: string
  stems: StemRole[]
  // False while the sidecar is not running or did not answer as a v2 processor.
  ready: boolean
}

export interface StemPeaks {
  min: number[]
  max: number[]
}

// Measured on the stem itself, never copied from the full mix.
export interface StemMeasuredFacts {
  bpm?: { value: number; confidence: number | null }
  key?: { pitchClass: CanonicalKeyPitchClass; mode: KeyMode; confidence: number | null }
}

export interface StemFileView {
  role: StemRole
  peakDb: number
  rmsDb: number
  durationSec: number
  bytes: number
  peaks: StemPeaks
  // Near-silent stems (a vocal stem of an instrumental) are flagged, not hidden.
  silent: boolean
  measured: StemMeasuredFacts
}

export interface StemSetView {
  id: string
  createdAt: number
  providerId: string
  providerName: string
  providerVersion: string
  model: string
  modelLabel: string
  backend: string
  notice?: string
  computeMs: number
  residualDb: number
  stems: StemFileView[]
}

export interface StemJobView {
  id: string
  trackId: string
  providerId: string
  providerName: string
  backend: StemBackend
  status: StemJobStatus
  progress: number
  stage?: string
  runningOn?: string
  notice?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export interface TrackStemsView {
  sets: StemSetView[]
  job?: StemJobView
}

export interface StemSettings {
  defaultProvider?: string
  backend: StemBackend
}

export interface StemsSnapshot {
  settings: StemSettings
  providers: StemProviderView[]
}

export interface StemsApi {
  stems: {
    snapshot: () => Promise<IpcResult<StemsSnapshot>>
    setSettings: (patch: Partial<StemSettings>) => Promise<IpcResult<StemsSnapshot>>
    track: (trackId: string) => Promise<IpcResult<TrackStemsView>>
    split: (trackId: string, providerId?: string) => Promise<IpcResult<TrackStemsView>>
    cancel: (trackId: string) => Promise<IpcResult<TrackStemsView>>
    remove: (trackId: string, setId: string) => Promise<IpcResult<TrackStemsView>>
    reveal: (trackId: string, setId: string, role: StemRole) => Promise<IpcResult<null>>
    dragOut: (trackId: string, setId: string, role: StemRole) => Promise<IpcResult<null>>
    exportSet: (trackId: string, setId: string) => Promise<IpcResult<number>>
  }
}

export const STEM_LABELS: Record<StemRole, string> = {
  'stem.vocals': 'Vocals',
  'stem.drums': 'Drums',
  'stem.bass': 'Bass',
  'stem.other': 'Other',
  'stem.guitar': 'Guitar',
  'stem.piano': 'Piano'
}

// Model facts shown in Settings and the split dialog. The processor reports
// its model id over /health; unknown ids fall back to the raw id.
const STEM_MODELS: Record<string, { label: string; description: string }> = {
  htdemucs: {
    label: 'Standard',
    description: 'Four stems. Balanced speed and quality; the recommended default.'
  },
  htdemucs_ft: {
    label: 'Fine-tuned',
    description: 'Four stems with the best separation. Roughly four times slower.'
  },
  htdemucs_6s: {
    label: 'Six stems',
    description: 'Adds guitar and piano. Those two stems are less reliable than the core four.'
  }
}

export function stemModelFacts(model: string): { label: string; description: string } {
  return STEM_MODELS[model] ?? { label: model, description: 'Stem separation model.' }
}

export const STEM_STAGE_LABELS: Record<string, string> = {
  queued: 'Waiting for the GPU to be free',
  decoding: 'Reading the track',
  loading: 'Loading the model',
  separating: 'Separating stems',
  writing: 'Writing stems',
  verifying: 'Checking stems and measuring BPM and key'
}
