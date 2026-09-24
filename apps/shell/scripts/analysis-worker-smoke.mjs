// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function wavFixture() {
  const sampleRate = 1000
  const frames = 1000
  const data = Buffer.alloc(frames * 4)
  for (let frame = 200; frame < 800; frame++) data.writeFloatLE(0.1, frame * 4)
  const wav = Buffer.alloc(44 + data.length)
  wav.write('RIFF', 0, 'latin1')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8, 'latin1')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(3, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 4, 28)
  wav.writeUInt16LE(4, 32)
  wav.writeUInt16LE(32, 34)
  wav.write('data', 36, 'latin1')
  wav.writeUInt32LE(data.length, 40)
  data.copy(wav, 44)
  return wav
}

async function workerResult(workerPath, filePath) {
  const worker = new Worker(workerPath, { workerData: { filePath } })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void worker.terminate()
      reject(new Error('analysis worker smoke timed out'))
    }, 10000)
    worker.once('message', (message) => {
      clearTimeout(timeout)
      void worker.terminate()
      resolve(message)
    })
    worker.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

const workerPath = process.argv[2]
assert(workerPath, 'usage: analysis-worker-smoke.mjs <built-worker>')
const root = await mkdtemp(join(tmpdir(), 'iblis-analysis-worker-'))
try {
  const filePath = join(root, 'audio.wav')
  await writeFile(filePath, wavFixture())
  const message = await workerResult(workerPath, filePath)
  assert(message?.ok === true, `worker failed: ${message?.code ?? message?.error ?? 'unknown'}`)
  assert(message.analysis?.version === 1, 'worker returned wrong analysis schema')
  assert(message.analysis?.peaks?.min?.length === 1000, 'worker peak count mismatch')
  assert(message.analysis?.audible?.classification === 'audible', 'worker bounds mismatch')
  assert(/^[a-f0-9]{64}$/.test(message.identity?.sha256 ?? ''), 'worker hash missing')

  const oversizedPath = join(root, 'oversized.wav')
  await writeFile(oversizedPath, Buffer.alloc(0))
  await truncate(oversizedPath, 512 * 1024 * 1024 + 1)
  const rejected = await workerResult(workerPath, oversizedPath)
  assert(rejected?.ok === false, 'worker accepted an oversized source')
  assert(rejected?.code === 'analysis_too_large', 'worker did not preflight source size')
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('analysis worker integration: ok')
