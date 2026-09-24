// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { readFile, stat } from 'node:fs/promises'
import type { Worker, WorkerOptions } from 'node:worker_threads'
import { analyzeWav } from '../electron/main/media/analysis'

export let workerStarts = 0
export let maxActiveWorkers = 0
let activeWorkers = 0

export function resetWorkerStats(): void {
  workerStarts = 0
  maxActiveWorkers = 0
  activeWorkers = 0
}

export default function createWorker(options: WorkerOptions): Worker {
  const emitter = new EventEmitter()
  let terminated = false
  let done = false
  workerStarts++
  activeWorkers++
  maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers)

  const timer = setTimeout(() => {
    if (terminated) return
    const filePath = (options.workerData as { filePath: string }).filePath
    void (async () => {
      const info = await stat(filePath)
      const bytes = await readFile(filePath)
      emitter.emit('message', {
        ok: true,
        analysis: analyzeWav(bytes),
        identity: {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          size: info.size,
          mtimeMs: info.mtimeMs
        }
      })
      done = true
      activeWorkers--
    })().catch((error: unknown) => emitter.emit('error', error))
  }, 10)

  const worker = Object.assign(emitter, {
    unref: (): void => {},
    terminate: async (): Promise<number> => {
      clearTimeout(timer)
      if (!done && !terminated) {
        terminated = true
        activeWorkers--
        emitter.emit('exit', 1)
      }
      return 0
    }
  })
  return worker as unknown as Worker
}
