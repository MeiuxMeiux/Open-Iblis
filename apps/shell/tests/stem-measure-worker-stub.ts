// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// In-thread stand-in for the stem measurement worker (vitest cannot load the
// electron-vite ?nodeWorker bundle). Same message shape as the real worker.

import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import type { Worker, WorkerOptions } from 'node:worker_threads'
import type { StemRole } from '@iblis/plugin-sdk'
import { measureStem } from '../electron/main/stems/measure'

export default function createWorker(options: WorkerOptions): Worker {
  const emitter = new EventEmitter() as EventEmitter & { terminate(): Promise<number> }
  emitter.terminate = () => Promise.resolve(0)
  const { files } = options.workerData as { files: { role: StemRole; path: string }[] }
  void (async () => {
    try {
      const results = []
      for (const file of files) results.push(measureStem(file.role, await readFile(file.path)))
      emitter.emit('message', { ok: true, results })
    } catch (error) {
      emitter.emit('message', { ok: false, message: String(error) })
    }
  })()
  return emitter as unknown as Worker
}
