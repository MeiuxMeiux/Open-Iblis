#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Stand-in for the training pack's Python sidecar (iblis_train/server.py) in
// the renderer E2E suite. Same loopback wire, no toolchain:
//   - Binds 127.0.0.1:<port>; every request needs X-Iblis-Session.
//   - GET  /health              -> { status: "ok" }
//   - GET  /props               -> { name, version }
//   - POST /job                 -> { ok } (body: { stage, jobId, params })
//   - GET  /job?id=             -> { state, stage, percent, detail, result? }
//   - POST /job?id=&cancel=1    -> { ok }
// Each stage runs for a few polls, then writes what the real stage would that
// the shell reads back: scan counts the audio files it can read, export
// leaves output/adapter_<category>.safetensors plus metadata.json.
'use strict'

/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS sidecar run by plain Node */
const http = require('node:http')
const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const SESSION_HEADER = 'x-iblis-session'
const STAGE_MS = 1200
const AUDIO = new Set(['.wav', '.flac', '.mp3'])
const STAGES = new Set([
  'scan',
  'stems',
  'tag',
  'dataset',
  'train-texture',
  'train-groove',
  'export'
])

const jobs = new Map() // jobId -> { stage, params, startedAt, state, result, error }

function parsePort(argv) {
  const i = argv.indexOf('--port')
  const port = i >= 0 ? Number(argv[i + 1]) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('fixture-train: --port <1-65535> is required')
  }
  return port
}

// Duration of a canonical 44-byte-header PCM WAV; other formats count as 0 s.
function wavSeconds(file) {
  const header = readFileSync(file).subarray(0, 44)
  if (header.length < 44 || header.toString('ascii', 0, 4) !== 'RIFF') return null
  const byteRate = header.readUInt32LE(28)
  const dataBytes = header.readUInt32LE(40)
  return byteRate > 0 ? dataBytes / byteRate : null
}

function scan(source) {
  let trackCount = 0
  let totalDurationSec = 0
  const skipped = []
  for (const name of readdirSync(source).sort()) {
    const ext = path.extname(name).toLowerCase()
    if (!AUDIO.has(ext)) {
      skipped.push({ name, reason: 'not an audio file' })
      continue
    }
    const seconds = ext === '.wav' ? wavSeconds(path.join(source, name)) : 0
    if (seconds === null) {
      skipped.push({ name, reason: 'unreadable audio' })
      continue
    }
    trackCount++
    totalDurationSec += seconds
  }
  return { trackCount, totalDurationSec, skipped }
}

// The smallest well-formed safetensors file: one F32 tensor of one element.
function safetensors() {
  const header = Buffer.from(
    JSON.stringify({ lora: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } })
  )
  const length = Buffer.alloc(8)
  length.writeBigUInt64LE(BigInt(header.length))
  return Buffer.concat([length, header, Buffer.alloc(4)])
}

function exportStyle(params) {
  const output = path.join(String(params.scratch), 'output')
  mkdirSync(output, { recursive: true })
  const files = []
  for (const category of params.categories ?? []) {
    const name = `adapter_${String(category)}.safetensors`
    writeFileSync(path.join(output, name), safetensors())
    files.push({ name })
  }
  writeFileSync(
    path.join(output, 'metadata.json'),
    JSON.stringify({ name: params.name, categories: params.categories, schemaVersion: 1 })
  )
  files.push({ name: 'metadata.json' })
  return { files }
}

function finish(stage, params) {
  switch (stage) {
    case 'scan':
      return scan(String(params.source))
    case 'train-texture':
    case 'train-groove':
      return { tier: '16gb', rank: 64, optimizer: 'adamw', precision: 'bf16' }
    case 'export':
      return exportStyle(params)
    default:
      return { ok: true }
  }
}

function poll(jobId) {
  const job = jobs.get(jobId)
  if (!job) return { state: 'idle' }
  if (job.state === 'running') {
    const fraction = (Date.now() - job.startedAt) / STAGE_MS
    if (fraction < 1) {
      return {
        state: 'running',
        stage: job.stage,
        percent: Math.round(fraction * 100),
        detail: `Working on ${job.stage}`
      }
    }
    try {
      job.result = finish(job.stage, job.params)
      job.state = 'done'
    } catch (error) {
      job.state = 'error'
      job.error = { code: 'stage_failed', message: String(error && error.message) }
    }
  }
  return { state: job.state, stage: job.stage, percent: 100, result: job.result, error: job.error }
}

function send(res, status, body) {
  const bytes = Buffer.from(JSON.stringify(body))
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': bytes.length })
  res.end(bytes)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve(null)
      }
    })
  })
}

async function handle(req, res) {
  if (!process.env.IBLIS_SESSION || req.headers[SESSION_HEADER] !== process.env.IBLIS_SESSION) {
    return send(res, 403, { error: 'forbidden' })
  }
  const url = new URL(req.url || '/', 'http://sidecar')
  const jobId = url.searchParams.get('id') || ''
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' })
  if (req.method === 'GET' && url.pathname === '/props') {
    return send(res, 200, { name: 'fixture-train', version: '0.0.1' })
  }
  if (req.method === 'GET' && url.pathname === '/job') return send(res, 200, poll(jobId))
  if (req.method === 'POST' && url.pathname === '/job' && url.searchParams.get('cancel') === '1') {
    const job = jobs.get(jobId)
    if (!job || job.state !== 'running') return send(res, 404, { error: 'no such active job' })
    job.state = 'cancelled'
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && url.pathname === '/job') {
    const body = await readBody(req)
    const stage = String(body && body.stage)
    const id = String((body && body.jobId) || '')
    if (!STAGES.has(stage) || !id) return send(res, 400, { error: `unknown stage: ${stage}` })
    if ([...jobs.values()].some((job) => job.state === 'running')) {
      return send(res, 409, { error: 'busy' })
    }
    const params = body.params && typeof body.params === 'object' ? body.params : {}
    jobs.set(id, { stage, params, startedAt: Date.now(), state: 'running' })
    return send(res, 200, { ok: true })
  }
  return send(res, 404, { error: 'not found' })
}

http
  .createServer((req, res) => {
    handle(req, res).catch((error) => send(res, 500, { error: String(error) }))
  })
  .listen(parsePort(process.argv), '127.0.0.1')
