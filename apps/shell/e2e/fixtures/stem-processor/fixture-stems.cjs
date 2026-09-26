#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// E2E stand-in for a stem-split processor. It speaks processor protocol v2
// exactly like the native sidecar but "separates" with fixed filters: a low
// band as bass, transients as drums, the midrange as other, and a quiet copy
// as vocals. Deterministic, dependency-free, a few hundred milliseconds.
'use strict'

/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS sidecar run by plain Node */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const SESSION = process.env.IBLIS_SESSION || ''
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const jobs = new Map()

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

// Minimal RIFF reader for the PCM16 / float32 WAVs the E2E suite seeds.
function readWav(file) {
  const b = fs.readFileSync(file)
  let off = 12
  let fmt = null
  let data = null
  while (off + 8 <= b.length) {
    const id = b.toString('latin1', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(off + 8), ch: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) }
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size)
    off += 8 + size + (size % 2)
  }
  const step = fmt.bits / 8
  const frames = data.length / (step * fmt.ch)
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * step
      sum += fmt.tag === 3 ? data.readFloatLE(o) : data.readInt16LE(o) / 32768
    }
    mono[i] = sum / fmt.ch
  }
  return { mono, rate: fmt.rate }
}

function writeWav(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 8)
  for (let i = 0; i < samples.length; i++) {
    data.writeFloatLE(samples[i], i * 8)
    data.writeFloatLE(samples[i], i * 8 + 4)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'latin1')
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8, 'latin1')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(3, 20)
  h.writeUInt16LE(2, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 8, 28)
  h.writeUInt16LE(8, 32)
  h.writeUInt16LE(32, 34)
  h.write('data', 36, 'latin1')
  h.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([h, data]))
}

function separate(input, dir) {
  const { mono, rate } = readWav(input)
  const bass = new Float32Array(mono.length)
  const drums = new Float32Array(mono.length)
  const other = new Float32Array(mono.length)
  const vocals = new Float32Array(mono.length)
  let low = 0
  let prev = 0
  for (let i = 0; i < mono.length; i++) {
    low += 0.02 * (mono[i] - low)
    const high = mono[i] - prev
    prev = mono[i]
    bass[i] = low
    drums[i] = high * 0.8 + (i % Math.round(rate / 2) < rate * 0.01 ? 0.6 * Math.sin(i * 0.05) : 0)
    other[i] = (mono[i] - low) * 0.7
    vocals[i] = mono[i] * 0.25
  }
  const out = { 'stem.vocals': vocals, 'stem.drums': drums, 'stem.bass': bass, 'stem.other': other }
  const outputs = []
  for (const [role, samples] of Object.entries(out)) {
    const name = `${role.slice(5)}.wav`
    writeWav(path.join(dir, name), samples, rate)
    outputs.push({ role, path: name, peakDb: -6, rmsDb: -20 })
  }
  return { outputs, metrics: { sampleRate: rate, frames: mono.length, seconds: mono.length / rate, residualDb: -28.4, computeMs: 900 } }
}

function start(body) {
  const job = { status: 'running', progress: 0, stage: 'separating', backend: 'cpu', startedAt: Date.now() }
  jobs.set(body.jobId, job)
  const timer = setInterval(() => {
    if (job.status !== 'running') return clearInterval(timer)
    job.progress = Math.min(0.9, (Date.now() - job.startedAt) / 1200)
    if (job.progress >= 0.9) {
      clearInterval(timer)
      try {
        Object.assign(job, separate(body.input.audioPath, body.stagingDir), { status: 'done', progress: 1, stage: 'writing' })
      } catch (error) {
        Object.assign(job, { status: 'error', error: String(error) })
      }
    }
  }, 100)
}

http
  .createServer(async (req, res) => {
    if (req.headers['x-iblis-session'] !== SESSION) return send(res, 401, { ok: false })
    const url = req.url || '/'
    if (req.method === 'GET' && url === '/health') {
      return send(res, 200, { ok: true, protocolVersion: 2, model: 'htdemucs', stems: ['vocals', 'drums', 'bass', 'other'], backends: ['cpu'] })
    }
    if (req.method === 'POST' && url === '/v2/transform') {
      const body = JSON.parse(await readBody(req))
      start(body)
      return send(res, 202, { protocolVersion: 2, jobId: body.jobId, accepted: true })
    }
    const m = /^\/v2\/jobs\/([A-Za-z0-9_-]+)(\/cancel)?$/.exec(url)
    const job = m && jobs.get(m[1])
    if (m && req.method === 'POST' && m[2]) {
      if (job && job.status === 'running') job.status = 'cancelled'
      return send(res, 200, { protocolVersion: 2, jobId: m[1], cancelled: Boolean(job) })
    }
    if (m && req.method === 'GET' && job) {
      const { startedAt, ...state } = job
      void startedAt
      return send(res, 200, { protocolVersion: 2, jobId: m[1], ...state })
    }
    return send(res, 404, { ok: false })
  })
  .listen(port, '127.0.0.1')
