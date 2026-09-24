// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Translation primitives between the Iblis engine contract (SDK engine.ts —
// what the renderer speaks) and the real `acestep.cpp` ace-server dialect.
//
// ace-server is two-phase and chattier than the clean contract (confirmed
// against tools/ace-server.cpp @ pin 948b929, mirrored from engine-smoke.sh):
//   POST /lm  {caption, lm_mode:"generate", seed?}  -> {id}   caption -> codes
//   POST /synth  <AceRequest | AceRequest[]>        -> {id}   codes   -> audio
//   poll GET /job?id=<id>&result=1: HTTP 200 + raw body ONLY when DONE
//     (/lm body = JSON array; /synth body = multipart/mixed); 404 otherwise.
//   GET /job?id=<id>: {status:"running|done|failed|cancelled"}
//
// These functions are pure (no I/O, no Electron) so they unit-test directly.

import type { GenerateRequest } from '@iblis/plugin-sdk'
import { normalizeWavPrefix, WavError, type NormalizedWav } from '../../../media/wav'

// /synth emits multipart/mixed with this exact boundary token
// (ace-server.cpp:273, MULTIPART_MIME at :327).
const BOUNDARY = '--ace-batch-boundary'
export const MAX_COMPARISON_BLUEPRINT_BYTES = 160 * 1024

// POST /lm body. Fields are confirmed against acestep.cpp @ pin 948b929:
// caption carries the prompt; `duration` (seconds, float, 0=unset) caps the
// generated length (src/request.h, fed to ace_lm_generate) — the LM emits 5Hz
// codes, so bounding this keeps both the LM decode and the synth tractable.
// /lm parses the FULL AceRequest, and the enriched objects it returns feed
// /synth verbatim — so sampling, model/adapter selection, independent seeds,
// and LM steering all ride in this one body.
//
// `lyrics`: when the request carries none, ace-server's LM WRITES ITS OWN and
// sings them on every track (src/pipeline-lm.cpp:679 — `need_lyrics =
// lyrics.empty()`). The exact sentinel "[Instrumental]" (pipeline-lm.cpp:697)
// is the upstream off-switch. Instrumental stays the default; auto-written
// lyrics are opt-in via config.autoLyrics (the field is then omitted).
export function lmBody(req: GenerateRequest): Record<string, unknown> {
  const c = req.config ?? {}
  const body: Record<string, unknown> = {
    caption: req.prompt,
    lm_mode: 'generate'
  }
  if (req.lyrics?.trim()) body.lyrics = req.lyrics
  else if (!c.autoLyrics) body.lyrics = '[Instrumental]'
  if (req.seed !== undefined) body.seed = req.seed
  if (c.lmSeed !== undefined) body.lm_seed = c.lmSeed
  if (req.durationSec > 0) body.duration = req.durationSec

  // Profile ids are labels only. Main resolves every sampling/model default
  // before queue persistence; protocol translation never invents steps from a
  // stale manifest preset.
  if (c.steps !== undefined && c.steps > 0) body.inference_steps = c.steps
  if (c.negativePrompt?.trim()) body.lm_negative_prompt = c.negativePrompt.trim()
  if (c.bpm !== undefined && c.bpm > 0) body.bpm = c.bpm
  if (c.keyscale?.trim()) body.keyscale = c.keyscale.trim()
  if (c.timeSignature?.trim()) body.timesignature = c.timeSignature.trim()
  if (c.guidance !== undefined) body.guidance_scale = c.guidance
  if (c.shift !== undefined) body.shift = c.shift
  if (c.solver?.trim()) body.solver = c.solver.trim()
  if (c.temperature !== undefined) body.lm_temperature = c.temperature
  if (c.rewritePrompt !== undefined) body.use_cot_caption = c.rewritePrompt
  if (c.lmModel?.trim()) body.lm_model = c.lmModel.trim()
  if (c.synthModel?.trim()) body.synth_model = c.synthModel.trim()
  if (c.adapter?.trim()) body.adapter = c.adapter.trim()
  if (c.adapterScale !== undefined) body.adapter_scale = c.adapterScale
  return body
}

// The /lm DONE body is a JSON array of enriched AceRequest objects that feed
// straight into /synth. We only stamp output_format (only ace_reqs[0]'s is
// read, but setting it on each is harmless — ace-server.cpp:1009-1020). wav32
// selects a 32-bit WAV with mime audio/wav.
export function synthBody(
  lmResultText: string,
  format = 'wav32',
  request?: GenerateRequest
): unknown[] {
  const parsed: unknown = JSON.parse(lmResultText)
  const arr = Array.isArray(parsed) ? parsed : [parsed]
  const config = request?.config ?? {}
  const overrides: Record<string, unknown> = {
    ...(request?.seed === undefined ? {} : { seed: request.seed }),
    ...(config.steps === undefined ? {} : { inference_steps: config.steps }),
    ...(config.guidance === undefined ? {} : { guidance_scale: config.guidance }),
    ...(config.shift === undefined ? {} : { shift: config.shift }),
    ...(config.solver === undefined ? {} : { solver: config.solver }),
    ...(config.synthModel ? { synth_model: config.synthModel } : {}),
    ...(config.adapter ? { adapter: config.adapter } : {}),
    ...(config.adapterScale === undefined ? {} : { adapter_scale: config.adapterScale })
  }
  return arr.map((o) => ({
    ...(o as Record<string, unknown>),
    ...overrides,
    output_format: format
  }))
}

export function validComparisonBlueprint(text: string): boolean {
  if (Buffer.byteLength(text, 'utf8') > MAX_COMPARISON_BLUEPRINT_BYTES) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  const values = Array.isArray(parsed) ? parsed : [parsed]
  return (
    values.length > 0 &&
    values.length <= 4 &&
    values.every(
      (value) =>
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).audio_codes === 'string' &&
        ((value as Record<string, unknown>).audio_codes as string).length > 0 &&
        ((value as Record<string, unknown>).audio_codes as string).length <= 128 * 1024
    )
  )
}

// Read a job-result POST response ({"id": ...}) into a string job id.
export function parseJobId(json: unknown): string {
  const id = (json as { id?: string | number | null } | null)?.id
  if (id === undefined || id === null || id === '') {
    throw new EngineError('no_job_id', 'response carried no job id')
  }
  return String(id)
}

// ace-server status strings that mean "stop polling, it will never produce a
// result" (GET /job?id=<id>, no result param).
export function isTerminalFailure(status: string | undefined): boolean {
  const s = (status ?? '').toLowerCase()
  return s === 'failed' || s === 'cancelled'
}

// Carve the audio/wav part out of a /synth multipart/mixed body. Mirrors the
// engine smoke: find the part whose headers declare audio/wav, then use the
// RIFF-declared size as the ONLY end marker. Sample bytes may themselves end in
// CR/LF or contain the multipart boundary token.
export function carveWav(raw: Buffer): NormalizedWav {
  const needle = Buffer.from(BOUNDARY)
  const marks: number[] = []
  for (let i = raw.indexOf(needle); i !== -1; i = raw.indexOf(needle, i + needle.length)) {
    marks.push(i)
  }

  for (const [k, mark] of marks.entries()) {
    const start = mark + needle.length
    const end = marks[k + 1] ?? raw.length
    const part = raw.subarray(start, end)

    // header/body separator: blank line (CRLF CRLF or LF LF), whichever first.
    const crlf = part.indexOf('\r\n\r\n')
    const lf = part.indexOf('\n\n')
    let sep = crlf
    let sepLen = 4
    if (sep === -1 || (lf !== -1 && lf < sep)) {
      sep = lf
      sepLen = 2
    }
    if (sep === -1) continue

    const hdr = part.subarray(0, sep).toString('latin1').toLowerCase()
    if (hdr.includes('audio/wav') || (hdr.includes('audio/') && hdr.includes('wav'))) {
      return normalizeCandidate(raw.subarray(start + sep + sepLen))
    }
  }

  // Fallback: RIFF magic identifies the body start; its uint32 length identifies
  // the end, even if the audio happens to contain a boundary-looking sequence.
  const riff = raw.indexOf('RIFF')
  if (riff !== -1) return normalizeCandidate(raw.subarray(riff))

  throw new EngineError('no_audio', 'no audio/wav part in the /synth response')
}

function normalizeCandidate(candidate: Buffer): NormalizedWav {
  try {
    return normalizeWavPrefix(candidate)
  } catch (error) {
    if (error instanceof WavError) {
      throw new EngineError('bad_wav', `${error.code}: ${error.message}`)
    }
    throw error
  }
}

// Typed engine failure with a stable code (surfaced as JobError.code).
export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'EngineError'
  }
}
