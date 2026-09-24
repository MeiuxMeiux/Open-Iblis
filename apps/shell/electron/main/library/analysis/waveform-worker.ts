// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import { analyzeWav, MAX_ANALYSIS_BYTES } from '../../media/analysis'
import { errorMessage } from '../../error-message'

interface WorkerInput {
  filePath: string
}

async function run(): Promise<void> {
  const { filePath } = workerData as WorkerInput
  const before = await stat(filePath)
  if (before.size > MAX_ANALYSIS_BYTES) {
    throw Object.assign(new Error('audio exceeds the analysis size limit'), {
      code: 'analysis_too_large'
    })
  }
  const bytes = await readFile(filePath)
  const analysis = analyzeWav(bytes)
  const after = await stat(filePath)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw Object.assign(new Error('audio changed during analysis'), { code: 'source_changed' })
  }
  parentPort?.postMessage({
    ok: true,
    analysis,
    identity: {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: after.size,
      mtimeMs: after.mtimeMs
    }
  })
}

void run().catch((error: unknown) => {
  parentPort?.postMessage({
    ok: false,
    error: errorMessage(error),
    code: String((error as { code?: unknown } | null)?.code ?? 'analysis_failed')
  })
})
