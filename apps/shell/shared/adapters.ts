// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Path-free adapter metadata allowed to cross the Electron boundary. These are
// owner-supplied claims, never a compatibility or rights certification.
export type ImportedAdapterFormat = 'safetensors' | 'peft'

export interface ImportedAdapterFile {
  name: 'adapter_model.safetensors' | 'adapter_config.json' | 'adapter.safetensors'
  sha256: string
  bytes: number
}

// How a library record arrived. Absent on pre-training records, which the
// UI treats as 'imported'. 'yours' marks a community training that this
// install authored and pulled back down.
type AdapterOrigin = 'imported' | 'downloaded' | 'yours'

export interface AdapterImportDetails {
  displayName: string
  // Set only by a reviewed in-app offer. This prevents multiple files from one
  // publisher page being mistaken for the same installed style.
  sourceOfferId?: string
  sourceUrl?: string
  sourceRevision?: string
  claimedLicense?: string
  terms?: string
  claimedBaseModel?: string
  origin?: AdapterOrigin
  // Community-training provenance, present when origin is yours/downloaded.
  trainingId?: string
  trainingVersion?: number
  // Set on styles this install trained: 'private' never left the machine,
  // 'community' was published. Absent on everything else.
  visibility?: 'private' | 'community'
}

export interface AdapterImportDisclosure extends AdapterImportDetails {
  acknowledgedAt: number
}

export interface ImportedAdapterRecord extends AdapterImportDisclosure {
  id: string
  format: ImportedAdapterFormat
  sha256: string
  bytes: number
  importedAt: number
  files: ImportedAdapterFile[]
}

// Diagnostics-only compatibility-gate data. These values deliberately contain
// no user-data paths, localhost ports, or native launch arguments.
type AdapterProofStage =
  | 'validating'
  | 'help'
  | 'empty-engine'
  | 'adapter-engine'
  | 'comparison'
  | 'restoring'
  | 'complete'

export interface AdapterProofProgress {
  stage: AdapterProofStage
  detail: string
}

export interface AdapterProofEngineSnapshot {
  startupMs: number
  vramMb: number | null
  lmModels: string[]
  synthModels: string[]
  adapters: string[]
}

export interface AdapterCompatibilityProof {
  proofId: string
  completedAt: number
  adapter: { id: string; sha256: string; format: ImportedAdapterFormat }
  engine: {
    id: string
    version: string
    executableSha256: string
    help: string
    ordinaryEngineRestored: boolean
  }
  empty: AdapterProofEngineSnapshot
  loaded: AdapterProofEngineSnapshot
  selectedAdapter: string
  // The off/on mapping stays in the local proof record so a listener can use
  // the ordinary file manager's A/B order without being primed by the result.
  audio: { firstId: string; firstSha256: string; secondId: string; secondSha256: string }
}

// Catalog-shaped, path-free recommendations rendered by the Style library.
// Community means the publisher, not Iblis, supplied the claims below.
export interface AdapterOffer {
  id: string
  name: string
  maker: string
  description: string
  tags: string[]
  format: ImportedAdapterFormat
  bytes: number
  sourceUrl: string
  sourceRevision: string
  claimedLicense: string
  terms: string
  claimedBaseModel: string
  compatibility: 'matches-active-pack' | 'different-model' | 'unverified'
  rights: 'commercial-claim' | 'research-only' | 'unknown'
  // Community source metadata cannot establish use rights or runtime fit. The
  // UI must require an explicit risk toggle before it can request an import.
  requiresRiskAcknowledgement: boolean
  installable: boolean
  availabilityNote?: string
  trigger?: string
  defaultScale?: number
  // Community entries have a reviewed, music-facing description. Experimental
  // entries deliberately expose publisher records that Iblis has not evaluated.
  lane: 'community' | 'experimental'
}

export interface AdapterInstallProgress {
  offerId: string
  received: number
  total: number
}
