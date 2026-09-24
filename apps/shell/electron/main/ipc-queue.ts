// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { ipcMain } from 'electron'
import type { GenerateRequest } from '@iblis/plugin-sdk'
import type { QueueComparisonVariant } from '../../shared/generation-queue'
import {
  cancelCurrentGeneration,
  clearGenerationHistory,
  discardGenerationComparison,
  duplicateGeneration,
  editGeneration,
  enqueueGenerationComparison,
  enqueueGeneration,
  moveGeneration,
  pauseGenerationQueue,
  queueSnapshot,
  removeGeneration,
  revealGenerationComparison,
  resumeGenerationQueue
} from './generation-queue'
import { resourceCoordinator } from './resource-state'
import { guardAsync } from './ipc-guard'

function refuseWhileLocked(): void {
  const refusal = resourceCoordinator().generationRefusal()
  if (refusal) throw new Error(refusal)
}

export function registerQueueIpc(): void {
  ipcMain.handle('queue:snapshot', () => guardAsync(queueSnapshot))
  ipcMain.handle('queue:enqueue', (_e, req: GenerateRequest) =>
    guardAsync(() => {
      // Local generation is never license-gated (D-O2); only the resource
      // coordinator (a running training) can refuse it.
      refuseWhileLocked()
      return enqueueGeneration(req)
    })
  )
  ipcMain.handle('queue:compare', (_e, req: GenerateRequest, variant: QueueComparisonVariant) =>
    guardAsync(() => {
      refuseWhileLocked()
      return enqueueGenerationComparison(req, variant)
    })
  )
  ipcMain.handle('queue:edit', (_e, id: string, req: GenerateRequest) =>
    guardAsync(() => editGeneration(id, req))
  )
  ipcMain.handle('queue:move', (_e, id: string, toIndex: number) =>
    guardAsync(() => moveGeneration(id, toIndex))
  )
  ipcMain.handle('queue:duplicate', (_e, id: string) =>
    guardAsync(() => {
      refuseWhileLocked()
      return duplicateGeneration(id)
    })
  )
  ipcMain.handle('queue:remove', (_e, id: string) => guardAsync(() => removeGeneration(id)))
  ipcMain.handle('queue:pause', () => guardAsync(pauseGenerationQueue))
  ipcMain.handle('queue:resume', () => guardAsync(resumeGenerationQueue))
  ipcMain.handle('queue:cancel', () => guardAsync(cancelCurrentGeneration))
  ipcMain.handle('queue:clear', () => guardAsync(clearGenerationHistory))
  ipcMain.handle('queue:reveal', (_e, groupId: string) =>
    guardAsync(() => revealGenerationComparison(groupId))
  )
  ipcMain.handle('queue:discard-comparison', (_e, groupId: string) =>
    guardAsync(() => discardGenerationComparison(groupId))
  )
}
