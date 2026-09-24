// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Worker-thread entry for the built-in detectors. One worker per job: the
// audio is decoded once, every requested capability runs, and a single
// message reports the outcome. Crashes and WASM state stay isolated here.

import { parentPort, workerData } from 'node:worker_threads'
import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
import { decodeWavMono } from './decode'
import { runBuiltinDetector } from './detect'
import { errorMessage } from '../../error-message'

interface DetectorWorkerInput {
  providerId: string
  audioPath: string
  capabilities: ProcessorAnalysisCapability[]
}

async function run(): Promise<void> {
  const input = workerData as DetectorWorkerInput
  const audio = await decodeWavMono(input.audioPath)
  const results = []
  for (const capability of input.capabilities) {
    results.push(
      await runBuiltinDetector(input.providerId, capability, audio.samples, audio.sampleRate)
    )
  }
  parentPort?.postMessage({ ok: true, results })
}

void run().catch((error: unknown) => {
  parentPort?.postMessage({
    ok: false,
    code: 'detector_failed',
    message: errorMessage(error),
    retryable: false
  })
})
