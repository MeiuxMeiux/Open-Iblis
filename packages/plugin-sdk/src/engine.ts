// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

// Engine sidecar HTTP contract. An `engine` (or other sidecar) plugin exposes
// this small API on 127.0.0.1:<port>. Every request must carry the session
// header; the sidecar refuses anything else. See docs/feature/engines.md.

// Header the shell sets per-session; blocks drive-by localhost attacks.
export const SESSION_HEADER = 'X-Iblis-Session'

export interface EnginePreset {
  id: string
  name: string
  minVramMb: number
}

// Solvers accepted by the pinned ACE-Step sidecar. Keep this closed: passing
// an arbitrary string makes the native process reject the request after work
// has already entered the queue.
export type EngineSolver = 'euler' | 'sde' | 'dpm3m' | 'stork4'

// Optional steering knobs. Every field is optional; absent = engine default.
// The host maps these to whatever dialect the active engine speaks (for
// ACE-Step: sampling, model/adapter selection, independent seeds, and LM
// steering fields on its full AceRequest object).
export interface GenerateConfig {
  negativePrompt?: string // what the track must NOT sound like
  bpm?: number
  keyscale?: string // e.g. "F minor"
  steps?: number // diffusion steps; bounded by the selected runtime profile
  guidance?: number // classifier-free guidance scale
  solver?: EngineSolver
  temperature?: number // LM sampling temperature
  // The engine's LM rewrites the caption (and invents bpm/key) before
  // generating unless this is false. Engine default: true.
  rewritePrompt?: boolean
  // With no lyrics given: false (default) = instrumental, true = let the
  // engine's LM write and sing its own lyrics.
  autoLyrics?: boolean
  // Runtime model names come from the bounded, validated sidecar /props
  // response. Main resolves omitted selections before queue persistence.
  lmModel?: string
  synthModel?: string
  timeSignature?: string
  shift?: number
  adapter?: string
  adapterScale?: number
  // LM sampling and synthesis use independent seeds upstream. Both are
  // materialized as uint32 values exactly once when main accepts a queue item.
  lmSeed?: number
  // Engine contract v2 advanced controls, keyed by the descriptor's control
  // id. Only ids the signed descriptor declares survive admission; a v1
  // engine rejects the key outright.
  advanced?: Record<string, boolean | number | string>
}

// POST /generate
export interface GenerateRequest {
  prompt: string
  lyrics?: string
  durationSec: number
  seed?: number
  preset: string
  config?: GenerateConfig
}

export interface GenerateResponse {
  jobId: string
}

// GET /jobs/:id
export type JobStatus = 'queued' | 'lm' | 'synth' | 'finishing' | 'done' | 'error'

export interface JobResult {
  // Path-free library identity. The renderer reaches audio through
  // iblis-track://<trackId>; filesystem paths never cross contextBridge.
  trackId: string
  format: string
  lyrics?: string
}

export interface JobError {
  code: string
  message: string
}

export interface JobState {
  status: JobStatus
  progress: number // 0..1
  result?: JobResult
  error?: JobError
}

// GET /health
export interface HealthResponse {
  ok: boolean
  version: string
  vramFreeMb?: number
}
