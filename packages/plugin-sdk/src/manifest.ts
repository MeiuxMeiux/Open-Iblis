// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import type { Capability } from './capabilities.js'
import type { SlotId } from './slots.js'
import type { EnginePreset } from './engine.js'

// The canonical PluginManifest. A plugin is a versioned directory + this
// manifest + (optionally) a native sidecar. See docs/feature/plugins.md.

export const PLUGIN_KINDS = [
  'engine',
  'processor',
  'image-gen',
  // Declarative metadata for a cloud service. The shell-owned cloud host, not
  // the plugin, owns credentials and the small allowlisted HTTPS surface.
  'cloud-provider',
  'visualizer',
  'ui-pack',
  'skin',
  // Opt-in training toolchain pack: sidecar-capable, spawned on demand by the
  // Training pipeline, never at app boot, never on the generation path
  // (docs/training/01-training-pack.md, charter Q8).
  'training'
] as const

export type PluginKind = (typeof PLUGIN_KINDS)[number]

export const isPluginKind = (v: unknown): v is PluginKind =>
  typeof v === 'string' && (PLUGIN_KINDS as readonly string[]).includes(v)

// Where a single asset can be fetched from. Tried in array order:
// vendor-direct first (zero bandwidth cost), GCS mirror as fallback,
// bundled only for tiny critical bytes. See plugins.md "Asset-source priority".
export type AssetSourceKind = 'vendor' | 'gcs' | 'bundled'

export interface AssetSource {
  kind: AssetSourceKind
  url: string // HTTPS only
}

export interface PluginAsset {
  // Path within the plugin version folder where the file is written.
  path: string
  // Lowercase hex SHA-256. Install fails on mismatch — identical across sources.
  sha256: string
  bytes: number
  // Ordered fetch sources; the shell falls through on any failure.
  sources: AssetSource[]
  // Set the executable bit on POSIX (native binaries).
  executable?: boolean
  // Extract this asset into the version folder after its hash verifies, then
  // remove the archive. For packs whose payload is a many-thousand-file tree
  // (e.g. an embedded Python runtime) where per-file assets are impractical.
  unpack?: 'zip'
}

// Sidecar configuration — only for kinds that run a native process.
export interface ExecutableSpec {
  // Asset path (relative to the version folder) of the binary to run.
  bin: string
  // Extra args appended after the shell's own (port, etc.). execFile arg array.
  args?: string[]
  // CLI flag the shell passes the auto-assigned port with. Default "--port".
  portArg?: string
  // Env var the shell sets the per-session secret in. Default "IBLIS_SESSION".
  sessionEnv?: string
  // Health-check path on 127.0.0.1:<port>. Default "/health".
  healthPath?: string
  // Max ms to wait for the first healthy response before failing the spawn.
  healthTimeoutMs?: number
  // Idle minutes before the shell offers to unload (engines keep weights hot).
  idleUnloadMinutes?: number
}

export interface SlotRegistration {
  slot: SlotId
  // Entry file (relative to the version folder) the shell loads for the slot.
  entry: string
  // Optional priority hint; the user can override ordering in Settings.
  priority?: number
}

export interface PluginAuthor {
  name: string
  url?: string
}

// Legal/research state for BPM/key processors. This is a closed disclosure and
// routing contract, not the host's interpretation of an upstream licence.
// Public catalog validation applies a stricter subset; private-lab validation
// keeps restricted candidates out of that public route.
export const EVALUATION_STATUSES = [
  'commercial-candidate',
  'evaluation-only',
  'licence-required',
  'blocked'
] as const

export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number]

export const EVALUATION_DISTRIBUTIONS = [
  'public-catalog',
  'private-lab',
  'vendor-direct-only'
] as const

export type EvaluationDistribution = (typeof EVALUATION_DISTRIBUTIONS)[number]

export interface ProcessorEvaluationV1 {
  status: EvaluationStatus
  distribution: EvaluationDistribution
  codeLicense: string
  modelLicense?: string
  dependencyLicenses: string[]
  termsUrl: string
  noticePath: string
  upstreamRevision: string
  acknowledgement: string
  releaseBlocker?: string
}

// JSON Schema (draft-07 shaped) for user-editable plugin settings. Kept as a
// permissive record — the shell renders a form from it, it is not a trust
// boundary the way assets are.
export type JsonSchema = Record<string, unknown>

// Engine contract v2 opt-in (docs/planning/2026-07-21-audio-platform,
// 03-engine-contract-v2.md). Static signed facts only: the hash-pinned
// descriptor asset carries the pack's maximum claims; GET /v2/descriptor
// later reports live facts that may only narrow them.
export interface EngineManifestSection {
  protocolVersion: 2
  // Path (within the version folder) of a declared, hash-verified asset
  // holding the signed EngineDescriptorV2 JSON.
  descriptorAsset: string
  execution: 'local-sidecar'
  // Absent = no adapter ingress: the shell never mirrors an adapter root or
  // appends an adapter CLI flag for this engine.
  adapterIngress?: 'iblis-root-v1'
}

export interface PluginManifest {
  id: string // reverse-DNS, e.g. "mx.iblis.engine.acestep"
  name: string
  version: string // SemVer of THIS manifest
  kind: PluginKind
  hostMinVersion: string // shell refuses to load if older
  capabilities: Capability[]
  slots?: SlotRegistration[]
  assets: PluginAsset[] // SHA-256 verified on install
  executable?: ExecutableSpec
  presets?: EnginePreset[] // engine kinds declare hardware presets
  // Engine contract v2 opt-in. Absent = v1 engine (ACE compatibility driver).
  engine?: EngineManifestSection
  configSchema?: JsonSchema
  // Required for processors that advertise BPM or key detection. It remains
  // absent on generic processors such as the lifecycle-test echo sidecar.
  evaluation?: ProcessorEvaluationV1
  // Cloud providers are a closed, host-recognized set. This is deliberately
  // metadata only: it cannot supply a URL, executable, or request code.
  cloudProvider?: { id: 'openrouter' | 'imagerouter' }
  license: string // SPDX of the plugin CODE (not bundled model weights)
  author: PluginAuthor
  bugUrl?: string
}
