#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: MIT

// echo-server — the Phase 2 stub sidecar. Zero dependencies, plain Node.
// It exists only to prove the plugin host end-to-end: install, spawn,
// health-check, hot-swap, roll back, remove. It does nothing musical.
//
// Contract (mirrors packages/plugin-sdk/src/engine.ts):
//   - Binds 127.0.0.1:<port> only. Never the public interface.
//   - Every request must carry header X-Iblis-Session === $IBLIS_SESSION.
//   - GET  /health -> { ok, name, version }
//   - POST /echo   -> { echo: <body>, receivedAt }
//
// The reported VERSION is bumped per release so a hot-swap is visible at
// /health (0.1.0 -> 0.1.1 proves the supervisor swapped the live process).
'use strict'

const http = require('node:http')

const NAME = 'echo-server'
const VERSION = '0.1.0'
const SESSION_HEADER = 'x-iblis-session' // node lowercases header names
const MAX_BODY_BYTES = 64 * 1024

function parsePort(argv) {
  const i = argv.indexOf('--port')
  const port = i >= 0 ? Number(argv[i + 1]) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('echo-server: --port <1-65535> is required')
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

function authorized(req, secret) {
  return req.headers[SESSION_HEADER] === secret
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

async function route(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    return sendJson(res, 200, { ok: true, name: NAME, version: VERSION })
  }
  if (req.method === 'POST' && req.url === '/echo') {
    const raw = await readBody(req)
    const echo = raw === '' ? null : safeParse(raw)
    return sendJson(res, 200, { echo, receivedAt: new Date().toISOString() })
  }
  return sendJson(res, 404, { ok: false, error: 'not found' })
}

function safeParse(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function main() {
  const secret = process.env.IBLIS_SESSION
  if (!secret) {
    process.stderr.write('echo-server: IBLIS_SESSION env is required\n')
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
    if (!authorized(req, secret)) {
      return sendJson(res, 401, { ok: false, error: 'unauthorized' })
    }
    route(req, res).catch((e) => sendJson(res, 400, { ok: false, error: String(e.message || e) }))
  })

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`echo-server ${VERSION} listening on 127.0.0.1:${port}\n`)
  })

  const shutdown = () => server.close(() => process.exit(0))
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main()
