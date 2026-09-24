// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Catalog, GenerateRequest } from '@iblis/plugin-sdk'
import type { TrackDetail } from './generation-record'
import type { EngineInfo, InstalledEngineSummary } from './engine-info'
import type { QueueComparisonVariant, QueueSnapshot } from './generation-queue'
import type { StylesDownloadProgress, StylesIndexView } from './styles'
import type {
  ResourceState,
  TrainingCategory,
  TrainingJobView,
  TrainingPackState,
  TrainingPreflightReport,
  TrainingProgressEvent,
  TrainingReserveResult,
  TrainingScanResult,
  TrainingStartInput,
  TrainingVisibility
} from './training'
import type { AudioAnalysis, MediaObservation } from './media'
import type { LicensingState } from './licensing'
import type { CloudProvidersApi } from './cloud-providers'
import type { FeedbackApi } from './feedback'
import type { EngineActionsApi } from './engine-actions'
import type { ProcessorsApi } from './processors-api'
import type { PluginInstallQueueSnapshot } from './plugin-install-queue'
import type { StorageLocation } from './storage-location'
import type {
  AdapterCompatibilityProof,
  AdapterImportDetails,
  AdapterInstallProgress,
  AdapterProofProgress,
  AdapterOffer,
  ImportedAdapterFormat,
  ImportedAdapterRecord
} from './adapters'
export type { QueueSnapshot } from './generation-queue'
export type { StorageLocation } from './storage-location'
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
// Opt-in diagnostics consent tiers (off by default). See docs/feature/diagnostics.md.
export type DiagLevel = 'off' | 'errors' | 'verbose'
export type { PerfInfo, PerfProfile, PerfSettings } from './perf'
import type { PerfInfo, PerfSettings } from './perf'
export const ok = <T>(data: T): IpcResult<T> => ({ ok: true, data })
export const err = (error: string): IpcResult<never> => ({ ok: false, error })
// What the UI shows per installed plugin: which version is active and which
// versions are on disk (for rollback). Derived from the on-disk layout.
export interface InstalledPlugin {
  id: string
  activeVersion: string | null
  versions: string[]
}
// A skin plugin resolved for the renderer: the validated descriptor of its
// active version (read from the on-disk asset in main) plus the optional
// extras.css text. `id` is the plugin id (what the picker/data-skin use).
export interface InstalledSkin {
  id: string
  name: string
  version: string
  theme?: 'dark' | 'light'
  extends?: string
  tokens: Record<string, string>
  css?: string // extras.css contents, if the descriptor declared one
}
// Live state of a plugin's sidecar process, surfaced as a status dot in the UI.
// Absent from the health map => no sidecar (renderer-only plugin or stopped).
export interface SidecarHealth {
  running: boolean
  port: number | null
  version: string | null
  breakerOpen: boolean // crashed past the restart limit; not auto-restarting
}
export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  // True for the signed installers the release workflow builds; false for a
  // source build (no auto-update, no hosted services unless configured).
  officialBuild: boolean
}
export interface WindowState {
  maximized: boolean
}
// Per-plugin install progress, pushed from main as assets stream to disk.
// `received`/`total` track the asset currently downloading; `overall*` and
// `percent` aggregate across every asset in the manifest (a plugin may declare
// several — e.g. an engine's GGUFs). `total`/`overallTotal` are 0 when the
// manifest omits byte counts; the UI falls back to an indeterminate bar.
export interface InstallProgress {
  id: string
  version: string
  asset: string // path of the asset currently downloading
  assetIndex: number // 0-based index of that asset
  assetCount: number // total assets in the manifest
  received: number // bytes received for the current asset
  total: number // declared bytes for the current asset (0 if unknown)
  overallReceived: number // bytes received across all assets so far
  overallTotal: number // sum of declared bytes across all assets (0 if any unknown)
  percent: number // 0..100 overall, best-effort (0 when overallTotal is 0)
}

// Engine facts (profiles, capabilities, picker summaries) live in
// ./engine-info; re-exported so existing imports keep working.
export type {
  EngineCapabilities,
  EngineInfo,
  EngineProfile,
  EngineRuntimeInfo,
  InstalledEngineSummary
} from './engine-info'

// Measured audio/media facts live in ./media; re-exported so every existing
// `from '../shared/contract'` import keeps working.
export type {
  AudibleBounds,
  AudioAnalysis,
  MediaObservation,
  PeakEnvelope,
  WavFacts
} from './media'

import type {
  LibraryTrack,
  LibraryFolder,
  LibraryOrganizerSnapshot,
  LibraryPrompt
} from './library'
export type {
  LibraryTrack,
  LibraryFolder,
  LibraryOrganizerSnapshot,
  LibraryPrompt
} from './library'

// Auto-update lifecycle, pushed from main as it progresses. The renderer
// only renders these; the network work happens entirely in the main process.
export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'current' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; error: string }

export interface IblisApi extends CloudProvidersApi, EngineActionsApi, FeedbackApi, ProcessorsApi {
  app: {
    getInfo: () => Promise<IpcResult<AppInfo>>
  }
  storage: {
    location: () => Promise<IpcResult<StorageLocation>>
    chooseLocation: () => Promise<IpcResult<StorageLocation>>
    restartToApply: () => Promise<IpcResult<null>>
  }
  window: {
    minimize: () => Promise<IpcResult<null>>
    toggleMaximize: () => Promise<IpcResult<WindowState>>
    isMaximized: () => Promise<IpcResult<WindowState>>
    close: () => Promise<IpcResult<null>>
    // Subscribe to maximize/unmaximize. Returns an unsubscribe fn.
    onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
  }
  update: {
    getStatus: () => Promise<IpcResult<UpdateStatus | null>>
    // Subscribe to update lifecycle events. Returns an unsubscribe fn.
    onStatus: (cb: (status: UpdateStatus) => void) => () => void
    checkNow: () => Promise<IpcResult<null>>
    // Quit and install a downloaded update.
    install: () => Promise<IpcResult<null>>
  }
  catalog: {
    // Fetch + Ed25519-verify + validate the signed plugin catalog.
    list: () => Promise<IpcResult<Catalog>>
  }
  plugins: {
    // Installed plugins and their on-disk versions.
    listInstalled: () => Promise<IpcResult<InstalledPlugin[]>>
    // Install + activate a catalog entry (resolved + re-verified in main).
    install: (id: string, version: string) => Promise<IpcResult<InstalledPlugin>>
    // Subscribe to streamed install progress (all installs, keyed by id in the
    // payload). Returns an unsubscribe fn. Network work stays in main.
    onInstallProgress: (cb: (p: InstallProgress) => void) => () => void
    installQueue: () => Promise<IpcResult<PluginInstallQueueSnapshot>>
    onInstallQueue: (cb: (snapshot: PluginInstallQueueSnapshot) => void) => () => void
    // Cancel an in-flight install. The pending install() call resolves with
    // { ok: false, error: 'install cancelled' }; no partial is left on disk.
    cancelInstall: (id: string) => Promise<IpcResult<null>>
    // Flip the active pointer to the previous installed version.
    rollback: (id: string) => Promise<IpcResult<InstalledPlugin>>
    // Remove a plugin and all its versions from disk.
    remove: (id: string) => Promise<IpcResult<null>>
    // Live sidecar health, keyed by plugin id (running plugins only).
    health: () => Promise<IpcResult<Record<string, SidecarHealth>>>
  }
  adapters: {
    list: () => Promise<IpcResult<ImportedAdapterRecord[]>>
    importFromDialog: (
      format: ImportedAdapterFormat,
      details: AdapterImportDetails,
      acknowledged: boolean
    ) => Promise<IpcResult<ImportedAdapterRecord | null>>
    remove: (id: string) => Promise<IpcResult<null>>
    reveal: (id: string) => Promise<IpcResult<null>>
    offers: () => Promise<IpcResult<AdapterOffer[]>>
    installOffer: (
      id: string,
      acknowledged: boolean
    ) => Promise<IpcResult<ImportedAdapterRecord | null>>
    onInstallProgress: (cb: (progress: AdapterInstallProgress) => void) => () => void
    runCompatibilityProof: (id: string) => Promise<IpcResult<AdapterCompatibilityProof | null>>
    onCompatibilityProofProgress: (cb: (progress: AdapterProofProgress) => void) => () => void
    revealCompatibilityProof: (proofId: string) => Promise<IpcResult<null>>
  }
  skins: {
    list: () => Promise<IpcResult<InstalledSkin[]>>
  }
  engine: {
    // Active engine state plus bounded, validated runtime model/profile facts.
    info: () => Promise<IpcResult<EngineInfo>>
    // Installed engines for the picker; select stores the default target for
    // new takes (per-operation under the hood) without touching queued work.
    list: () => Promise<IpcResult<InstalledEngineSummary[]>>
    select: (pluginId: string) => Promise<IpcResult<InstalledEngineSummary[]>>
  }
  queue: {
    snapshot: () => Promise<IpcResult<QueueSnapshot>>
    enqueue: (request: GenerateRequest) => Promise<IpcResult<QueueSnapshot>>
    compare: (
      request: GenerateRequest,
      variant: QueueComparisonVariant
    ) => Promise<IpcResult<QueueSnapshot>>
    edit: (id: string, request: GenerateRequest) => Promise<IpcResult<QueueSnapshot>>
    move: (id: string, toIndex: number) => Promise<IpcResult<QueueSnapshot>>
    duplicate: (id: string) => Promise<IpcResult<QueueSnapshot>>
    remove: (id: string) => Promise<IpcResult<QueueSnapshot>>
    pause: () => Promise<IpcResult<QueueSnapshot>>
    resume: () => Promise<IpcResult<QueueSnapshot>>
    cancel: () => Promise<IpcResult<QueueSnapshot>>
    clear: () => Promise<IpcResult<QueueSnapshot>>
    reveal: (groupId: string) => Promise<IpcResult<QueueSnapshot>>
    discardComparison: (groupId: string) => Promise<IpcResult<QueueSnapshot>>
    onSnapshot: (cb: (snapshot: QueueSnapshot) => void) => () => void
  }
  library: {
    // Every track, newest first.
    list: () => Promise<IpcResult<LibraryTrack[]>>
    // Full generation provenance and measured audio facts for one track.
    detail: (id: string, includeAnalysis?: boolean) => Promise<IpcResult<TrackDetail>>
    // Rename in place: metadata only, the file on disk never moves.
    rename: (id: string, name: string) => Promise<IpcResult<LibraryTrack>>
    // Like (1) / dislike (-1) / clear (0).
    rate: (id: string, rating: -1 | 0 | 1) => Promise<IpcResult<LibraryTrack>>
    // Organizer metadata and track filing. No operation moves an audio file.
    folders: () => Promise<IpcResult<LibraryFolder[]>>
    folderCreate: (name: string) => Promise<IpcResult<LibraryFolder>>
    folderRename: (id: string, name: string) => Promise<IpcResult<LibraryFolder>>
    folderRemove: (id: string) => Promise<IpcResult<LibraryOrganizerSnapshot>>
    moveToFolder: (id: string, folderId?: string) => Promise<IpcResult<LibraryTrack>>
    // Remove the row and trash the audio folder (OS trash, hard-delete fallback).
    remove: (id: string) => Promise<IpcResult<null>>
    // Open the track's folder in the OS file manager.
    reveal: (id: string) => Promise<IpcResult<null>>
    // Begin an OS drag of the audio file (called from an ondragstart handler).
    dragOut: (id: string) => Promise<IpcResult<null>>
    // Record Chromium's duration/seekable view in the main diagnostic log.
    mediaObserved: (id: string, observation: MediaObservation) => Promise<IpcResult<null>>
    // Load a validated persisted envelope, analyzing a legacy track lazily.
    analysis: (id: string) => Promise<IpcResult<AudioAnalysis>>
    // Prompt history, starred first then most recent.
    prompts: () => Promise<IpcResult<LibraryPrompt[]>>
    promptStar: (id: string, starred: boolean) => Promise<IpcResult<LibraryPrompt>>
    promptRemove: (id: string) => Promise<IpcResult<null>>
    // Clear history, sparing starred prompts; resolves with the removed count.
    promptsClear: () => Promise<IpcResult<number>>
  }
  diag: {
    // Current consent tier (off by default).
    getLevel: () => Promise<IpcResult<DiagLevel>>
    setLevel: (level: DiagLevel) => Promise<IpcResult<null>>
    // Build + upload one redacted bundle now; resolves with the server ref.
    send: (note?: string) => Promise<IpcResult<{ ref: string }>>
  }
  perf: {
    // Saved performance profile + this machine's core/thread numbers.
    info: () => Promise<IpcResult<PerfInfo>>
    // Persist a profile; resolves with refreshed info. Applies on engine restart.
    set: (settings: PerfSettings) => Promise<IpcResult<PerfInfo>>
    // Hot-swap the running engine(s) so a new thread cap takes effect now.
    restartEngine: () => Promise<IpcResult<null>>
  }
  resource: {
    // The shared idle/generating/training/engine-mutation lock state.
    state: () => Promise<IpcResult<ResourceState>>
    // Subscribe to lock changes. Returns an unsubscribe fn.
    onState: (cb: (state: ResourceState) => void) => () => void
  }
  training: {
    // Whether the training pack is installed, and at which version.
    packState: () => Promise<IpcResult<TrainingPackState>>
    // Hardware/queue/pack readiness rows for the Training section.
    preflight: () => Promise<IpcResult<TrainingPreflightReport>>
    // Wizard step 1-2: native folder picker + probe scan. Null on cancel.
    // The renderer receives a folder token and a summary, never the path.
    scanFolder: () => Promise<IpcResult<TrainingScanResult | null>>
    // Whether a new training would publish ('community') or stay on this
    // machine ('private'); main decides from the licensing state.
    visibility: () => Promise<IpcResult<TrainingVisibility>>
    // Wizard step 3: reserve the public name on the community service, or,
    // for a private training, check it locally without any network call.
    reserveName: (
      name: string,
      categories: TrainingCategory[]
    ) => Promise<IpcResult<TrainingReserveResult>>
    // Wizard step 5: launch. Consent flags are required; main stamps times.
    start: (input: TrainingStartInput) => Promise<IpcResult<TrainingJobView>>
    list: () => Promise<IpcResult<TrainingJobView[]>>
    // Cooperative cancel of the running job's active stage.
    cancel: (jobId: string) => Promise<IpcResult<null>>
    // Re-run an interrupted/failed job from its first unfinished stage.
    resume: (jobId: string) => Promise<IpcResult<TrainingJobView>>
    // Remove a job row and its local scratch (never the server copy).
    deleteJob: (jobId: string) => Promise<IpcResult<null>>
    // Resume a stranded upload by part; only valid from awaiting-upload.
    retryUpload: (jobId: string) => Promise<IpcResult<null>>
    onProgress: (cb: (event: TrainingProgressEvent) => void) => () => void
    onJobs: (cb: (jobs: TrainingJobView[]) => void) => () => void
  }
  styles: {
    // Verified community-trainings index (offline cache fallback), with
    // yours/installed flags resolved. force bypasses the 15-minute window.
    index: (force?: boolean) => Promise<IpcResult<StylesIndexView>>
    // Managed download of one index entry into the adapter library.
    // Resolves with the new adapter record id.
    download: (id: string) => Promise<IpcResult<string>>
    // Remove a downloaded style from the local library (never the server).
    remove: (adapterId: string) => Promise<IpcResult<null>>
    onDownloadProgress: (cb: (progress: StylesDownloadProgress) => void) => () => void
  }
  licensing: {
    state: () => Promise<IpcResult<LicensingState>>
    // Redeem a product key online; the state answer carries lastError with
    // the stable refusal code when the server said no.
    activate: (key: string) => Promise<IpcResult<LicensingState>>
    // "Remove key from this device": best-effort server call + local wipe.
    deactivate: () => Promise<IpcResult<LicensingState>>
    // Manual "Revalidate now".
    refresh: () => Promise<IpcResult<LicensingState>>
    onState: (cb: (state: LicensingState) => void) => () => void
  }
}
