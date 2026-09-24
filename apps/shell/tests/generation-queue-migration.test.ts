// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import { createGenerationQueueScheduler } from '../electron/main/generation-queue/scheduler'
import { createGenerationQueueStore } from '../electron/main/generation-queue/store'
import { aceQueueRules } from './generation-queue-fixtures'

const legacyRequest: GenerateRequest = {
  prompt: 'old recipe',
  durationSec: 30,
  preset: 'fast',
  config: { steps: 8 }
}

describe('generation queue schema migration', () => {
  it('migrates a v1 pending recipe for review instead of quarantining it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iblis-queue-migrate-'))
    const file = join(root, 'generation-queue.json')
    try {
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          paused: false,
          entries: [
            {
              id: 'legacy',
              request: legacyRequest,
              status: 'pending',
              createdAt: 1,
              updatedAt: 2
            }
          ]
        }),
        'utf8'
      )
      const store = createGenerationQueueStore(file, aceQueueRules)
      const queue = createGenerationQueueScheduler({
        store,
        engine: {
          start: () => {
            throw new Error('legacy request must not start')
          },
          state: () => undefined,
          settled: async () => undefined,
          cancel: async () => {}
        }
      })
      const snapshot = await queue.init()

      expect(snapshot).toMatchObject({
        paused: true,
        entries: [
          {
            id: 'legacy',
            status: 'interrupted',
            error: { code: 'legacy_queue_recipe' }
          }
        ]
      })
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 2 })
      await expect(readFile(`${file}.corrupt`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
