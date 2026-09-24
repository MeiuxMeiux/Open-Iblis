#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: MIT

// fixture-engine — the canonical engine-contract-v2 test sidecar (roadmap 4C).
// Zero dependencies, plain Node. Its models, phases, controls, and outputs are
// deliberately unlike ACE-Step so nothing ACE-shaped can pass by imitation:
// the host must speak the strict v2 wire or nothing works.
//
// Wire (mirrors packages/plugin-sdk/src/engine-v2*.ts):
//   - Binds 127.0.0.1:<port> only; every request needs X-Iblis-Session.
//   - GET  /health              -> { ok, name, version }
//   - GET  /v2/descriptor       -> live EngineDescriptorV2 (never broader
//                                  than the signed engine.v2.json beside us)
//   - POST /v2/jobs             -> { jobId } (body: { recipe, staging })
//   - GET  /v2/jobs/:id         -> EngineJobStateV2
//   - POST /v2/jobs/:id/cancel  -> { ok }
//
// Test-only hostile modes via IBLIS_FIXTURE_MODE:
//   broaden -> live descriptor smuggles an unsigned profile (host must refuse)
//   escape  -> job reports an output path outside staging (host must refuse)
//   fail    -> every job errors with a bounded code/message
// IBLIS_FIXTURE_JOB_MS overrides the simulated job length (default 900 ms).
'use strict'

const http = require('node:http')
const { randomUUID } = require('node:crypto')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const NAME = 'fixture-engine'
const VERSION = '0.1.0'
const SESSION_HEADER = 'x-iblis-session'
const MAX_BODY_BYTES = 64 * 1024
const JOB_MS = clampInt(process.env.IBLIS_FIXTURE_JOB_MS, 50, 600000, 900)
const MODE = process.env.IBLIS_FIXTURE_MODE || ''
const SAMPLE_RATE = 22050

// The three phases and their share of the run. Nothing here resembles the
// ACE lm/synth/finishing vocabulary on purpose.
const PHASES = [
  { id: 'prime', until: 0.25 },
  { id: 'sketch', until: 0.85 },
  { id: 'varnish', until: 1 }
]

const jobs = new Map() // jobId -> { status, progress, phase, timer, staging, recipe, error, outputs }

function clampInt(raw, min, max, fallback) {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) return fallback
  return value
}

function parsePort(argv) {
  const i = argv.indexOf('--port')
  const port = i >= 0 ? Number(argv[i + 1]) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('fixture-engine: --port <1-65535> is required')
  }
  return port
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) reject(new Error('body too large'))
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function signedDescriptor() {
  // Installed layout: flat beside the bin. Source tree: one level up from src/.
  for (const dir of [__dirname, path.join(__dirname, '..')]) {
    try {
      return JSON.parse(readFileSync(path.join(dir, 'engine.v2.json'), 'utf8'))
    } catch {
      // try the next location
    }
  }
  throw new Error('engine.v2.json is missing beside the fixture')
}

function liveDescriptor() {
  const descriptor = signedDescriptor()
  if (MODE === 'broaden') {
    descriptor.profiles.push({ id: 'contraband', label: 'Contraband', modelId: 'pastiche-mini' })
    descriptor.operations[0].profileIds.push('contraband')
  }
  return descriptor
}

// --- deterministic little melody ------------------------------------------

function lcg(seed) {
  let state = (seed >>> 0) || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

// A pentatonic sketch: seed picks the notes, bpm sets the note grid, layers
// stack detuned voices, crackle adds pseudo-vinyl noise. Real audio out of a
// fixture keeps the host's WAV validation and Library ingestion honest.
function renderMix(recipe) {
  const durationSec = Math.min(Math.max(recipe.targetDurationSec || 8, 1), 120)
  const bpm = (recipe.common && recipe.common.bpm) || 96
  const advanced = recipe.advanced || {}
  const layers = clampInt(advanced.layers, 1, 8, 3)
  const crackle = advanced.crackle === true
  const total = Math.floor(durationSec * SAMPLE_RATE)
  const samples = new Int16Array(total)
  const rand = lcg(recipe.seed === undefined ? 12345 : recipe.seed)
  const scale = [220, 247.5, 277.2, 330, 371.25]
  const noteSamples = Math.max(1, Math.floor((60 / bpm) * SAMPLE_RATE))
  let note = scale[Math.floor(rand() * scale.length)]
  for (let i = 0; i < total; i++) {
    if (i % noteSamples === 0) note = scale[Math.floor(rand() * scale.length)]
    let value = 0
    for (let voice = 0; voice < layers; voice++) {
      const detune = 1 + voice * 0.005
      value += Math.sin((2 * Math.PI * note * detune * i) / SAMPLE_RATE) / layers
    }
    if (crackle && rand() < 0.0005) value += rand() - 0.5
    const envelope = Math.min(1, (i % noteSamples) / 200) * (1 - (i % noteSamples) / noteSamples)
    samples[i] = Math.max(-1, Math.min(1, value * envelope * 0.5)) * 32767
  }
  return samples
}

function wavBytes(samples) {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(samples[i], 44 + i * 2)
  return buffer
}

// --- job lifecycle ---------------------------------------------------------

function recipeError(recipe) {
  if (!recipe || typeof recipe !== 'object') return 'recipe must be an object'
  if (recipe.protocolVersion !== 2) return 'recipe.protocolVersion must be 2'
  if (recipe.operation !== 'music.generate') return 'unsupported operation'
  if (typeof recipe.prompt !== 'string' || recipe.prompt.length === 0) {
    return 'music.generate requires a prompt'
  }
  const descriptor = signedDescriptor()
  if (!descriptor.operations[0].profileIds.includes(recipe.profileId)) {
    return `unknown profile ${String(recipe.profileId)}`
  }
  return null
}

function finishJob(job) {
  if (job.status !== 'running') return
  try {
    if (MODE === 'fail') {
      job.status = 'error'
      job.error = { code: 'paint_dry', message: 'the fixture was asked to fail this job' }
      return
    }
    const mix = wavBytes(renderMix(job.recipe))
    const previewSamples = renderMix({ ...job.recipe, targetDurationSec: 2 })
    mkdirSync(job.staging, { recursive: true })
    writeFileSync(path.join(job.staging, 'mix.wav'), mix)
    writeFileSync(path.join(job.staging, 'preview.wav'), wavBytes(previewSamples))
    job.status = 'done'
    job.progress = 1
    job.phase = undefined
    job.outputs =
      MODE === 'escape'
        ? [{ role: 'mix', path: '../escape.wav' }]
        : [
            { role: 'mix', path: 'mix.wav' },
            { role: 'preview', path: 'preview.wav' }
          ]
  } catch (e) {
    job.status = 'error'
    job.error = { code: 'render_failed', message: String(e.message || e).slice(0, 1024) }
  }
}

function startJob(recipe, staging) {
  const jobId = `fx-${randomUUID()}`
  const job = { status: 'running', progress: 0, phase: PHASES[0].id, staging, recipe }
  jobs.set(jobId, job)
  const startedAt = Date.now()
  job.timer = setInterval(() => {
    if (job.status !== 'running') return clearInterval(job.timer)
    const fraction = Math.min(1, (Date.now() - startedAt) / JOB_MS)
    job.progress = Math.min(fraction, 0.99)
    job.phase = (PHASES.find((phase) => fraction <= phase.until) || PHASES[2]).id
    if (fraction >= 1) {
      clearInterval(job.timer)
      finishJob(job)
    }
  }, 25)
  return jobId
}

function jobState(jobId, job) {
  const state = {
    protocolVersion: 2,
    jobId,
    status: job.status,
    progress: job.status === 'done' ? 1 : job.progress
  }
  if (job.status === 'running' && job.phase) state.phase = job.phase
  if (job.status === 'error') state.error = job.error
  if (job.status === 'done') state.outputs = job.outputs
  return state
}

// --- routing ---------------------------------------------------------------

async function route(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { ok: true, name: NAME, version: VERSION })
  }
  if (req.method === 'GET' && req.url === '/v2/descriptor') {
    return sendJson(res, 200, liveDescriptor())
  }
  if (req.method === 'POST' && req.url === '/v2/jobs') {
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return sendJson(res, 400, { error: 'body must be JSON' })
    }
    const invalid = recipeError(body && body.recipe)
    if (invalid) return sendJson(res, 400, { error: invalid })
    if (typeof body.staging !== 'string' || body.staging.length === 0) {
      return sendJson(res, 400, { error: 'staging directory is required' })
    }
    return sendJson(res, 200, { jobId: startJob(body.recipe, body.staging) })
  }
  const jobMatch = req.url && req.url.match(/^\/v2\/jobs\/([A-Za-z0-9-]+)(\/cancel)?$/)
  if (jobMatch) {
    const job = jobs.get(jobMatch[1])
    if (!job) return sendJson(res, 404, { error: 'unknown job' })
    if (req.method === 'POST' && jobMatch[2]) {
      if (job.status === 'running') {
        clearInterval(job.timer)
        job.status = 'cancelled'
        job.phase = undefined
      }
      return sendJson(res, 200, { ok: true })
    }
    if (req.method === 'GET' && !jobMatch[2]) {
      return sendJson(res, 200, jobState(jobMatch[1], job))
    }
  }
  return sendJson(res, 404, { error: 'not found' })
}

function main() {
  const secret = process.env.IBLIS_SESSION
  if (!secret) {
    process.stderr.write('fixture-engine: IBLIS_SESSION env is required\n')
    process.exit(1)
  }
  let port
  try {
    port = parsePort(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(1)
  }

  const server = http.createServer((req, res) => {
    if (req.headers[SESSION_HEADER] !== secret) {
      return sendJson(res, 401, { error: 'unauthorized' })
    }
    route(req, res).catch((e) => sendJson(res, 400, { error: String(e.message || e) }))
  })

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`fixture-engine ${VERSION} listening on 127.0.0.1:${port}\n`)
  })

  const shutdown = () => server.close(() => process.exit(0))
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
