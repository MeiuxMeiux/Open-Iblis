// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Executes the emitted built-in detector worker bundle against a synthetic
// 120 BPM / A minor WAV for every built-in provider. This is the packaged
// counterpart of tests/builtin-processors.test.ts: it proves the ?nodeWorker
// bundle loads its vendor libraries (essentia.js WASM, aubiojs, music-tempo)
// from the shipped module layout, not just from vitest's resolver.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const PROVIDERS = [
  { id: 'mx.iblis.builtin.dsp', capabilities: ['bpm-detect', 'key-detect'] },
  { id: 'mx.iblis.builtin.musictempo', capabilities: ['bpm-detect'] },
  { id: 'mx.iblis.builtin.essentia', capabilities: ['bpm-detect', 'key-detect'] },
  { id: 'mx.iblis.builtin.aubio', capabilities: ['bpm-detect'] }
]

function syntheticWav() {
  const sampleRate = 44100
  const seconds = 15
  const frames = sampleRate * seconds
  const samples = new Float32Array(frames)
  const beat = (60 / 120) * sampleRate
  for (let b = 0; b * beat < frames; b++) {
    const start = Math.round(b * beat)
    for (let i = 0; i < 800 && start + i < frames; i++) {
      samples[start + i] += Math.exp(-i / 120) * Math.sin(i * 0.9) * 0.8
    }
  }
  const freqs = [220, 261.63, 329.63]
  for (let i = 0; i < frames; i++) {
    const f = freqs[Math.floor(i / (beat / 2)) % 3]
    samples[i] +=
      0.3 * Math.sin((2 * Math.PI * f * i) / sampleRate) +
      0.12 * Math.sin((2 * Math.PI * 2 * f * i) / sampleRate)
  }
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2)
  }
  const wav = Buffer.alloc(44 + data.length)
  wav.write('RIFF', 0, 'latin1')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8, 'latin1')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'latin1')
  wav.writeUInt32LE(data.length, 40)
  data.copy(wav, 44)
  return wav
}

async function workerResult(workerPath, workerData) {
  const worker = new Worker(workerPath, { workerData })
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void worker.terminate()
      reject(new Error(`detector worker smoke timed out for ${workerData.providerId}`))
    }, 60000)
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
assert(workerPath, 'usage: detector-worker-smoke.mjs <built-worker>')
const root = await mkdtemp(join(tmpdir(), 'iblis-detector-worker-'))
try {
  const audioPath = join(root, 'audio.wav')
  await writeFile(audioPath, syntheticWav())
  for (const provider of PROVIDERS) {
    const message = await workerResult(workerPath, {
      providerId: provider.id,
      audioPath,
      capabilities: provider.capabilities
    })
    assert(message?.ok === true, `${provider.id} failed: ${message?.message ?? 'unknown'}`)
    assert(
      Array.isArray(message.results) && message.results.length === provider.capabilities.length,
      `${provider.id} returned ${message.results?.length ?? 0} results`
    )
    for (const result of message.results) {
      if (result.capability === 'bpm-detect') {
        assert(
          Math.abs(result.value.bpm - 120) < 5,
          `${provider.id} tempo ${result.value.bpm} is not ~120`
        )
      } else {
        assert(
          result.value.pitchClass === 'A' && result.value.mode === 'minor',
          `${provider.id} key ${result.value.pitchClass} ${result.value.mode} is not A minor`
        )
      }
    }
    console.log(
      `${provider.id}: ${message.results
        .map((result) =>
          result.capability === 'bpm-detect'
            ? `${result.value.bpm.toFixed(1)} BPM`
            : `${result.value.pitchClass} ${result.value.mode}`
        )
        .join(', ')}`
    )
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('detector worker integration: ok')
