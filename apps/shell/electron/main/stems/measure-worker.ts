// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Worker-thread entry: measure every staged stem off the main thread. Paths
// arrive from main's own staging directory, never from the renderer.

import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import type { StemRole } from '@iblis/plugin-sdk'
import { measureStem } from './measure'
import { errorMessage } from '../error-message'

interface MeasureInput {
  files: { role: StemRole; path: string }[]
}

async function run(): Promise<void> {
  const input = workerData as MeasureInput
  const results = []
  for (const file of input.files) {
    results.push(measureStem(file.role, await readFile(file.path)))
  }
  parentPort?.postMessage({ ok: true, results })
}

void run().catch((error: unknown) => {
  parentPort?.postMessage({ ok: false, message: errorMessage(error) })
})
