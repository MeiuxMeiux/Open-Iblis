// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Training-arc IPC handlers (resource lock + training surface), split from
// ipc.ts to keep both files inside the LOC cap. Registered by registerIpc().

import { ipcMain, BrowserWindow } from 'electron'
import type { TrainingCategory, TrainingStartInput } from '../../shared/training'
import { resourceState } from './resource-state'
import { requireLicenseFresh } from './licensing'
import { removeAdapter } from './adapters'
import { broadcastStylesProgress, downloadStyleFromIndex, stylesIndexView } from './styles'
import {
  cancelTraining,
  currentTrainingVisibility,
  deleteTrainingJob,
  listTrainingJobs,
  reserveTraining,
  resumeTraining,
  retryTrainingUpload,
  scanTrainingFolder,
  startTraining,
  trainingPackState,
  trainingPreflight
} from './training'
import { guard, guardAsync } from './ipc-guard'

export function registerTrainingIpc(): void {
  ipcMain.handle('resource:state', () => guard(resourceState))
  ipcMain.handle('training:packState', () => guard(trainingPackState))
  ipcMain.handle('training:preflight', () => guardAsync(() => trainingPreflight()))
  ipcMain.handle('training:scanFolder', (e) =>
    guardAsync(() => scanTrainingFolder(BrowserWindow.fromWebContents(e.sender)))
  )
  ipcMain.handle('training:visibility', () => guard(currentTrainingVisibility))
  ipcMain.handle('training:reserveName', (_e, name: string, categories: TrainingCategory[]) =>
    guardAsync(() => reserveTraining(name, categories))
  )
  ipcMain.handle('training:start', (_e, input: TrainingStartInput) =>
    // Local training is never license-gated (D-O2). Publishing the result
    // to the community service needs a lease; the uploader enforces that.
    guardAsync(() => startTraining(input))
  )
  ipcMain.handle('training:list', () => guardAsync(listTrainingJobs))
  ipcMain.handle('training:cancel', (_e, jobId: string) =>
    guardAsync(async () => {
      await cancelTraining(jobId)
      return null
    })
  )
  ipcMain.handle('training:resume', (_e, jobId: string) => guardAsync(() => resumeTraining(jobId)))
  ipcMain.handle('training:deleteJob', (_e, jobId: string) =>
    guardAsync(async () => {
      await deleteTrainingJob(jobId)
      return null
    })
  )
  ipcMain.handle('training:retryUpload', (_e, jobId: string) =>
    guardAsync(async () => {
      await retryTrainingUpload(jobId)
      return null
    })
  )

  ipcMain.handle('styles:index', (_e, force?: boolean) =>
    guardAsync(async () => {
      // Browsing happens on every Styles open; throttle the online re-check.
      await requireLicenseFresh('styles-community', 60 * 60_000)
      return stylesIndexView(force === true)
    })
  )
  ipcMain.handle('styles:download', (_e, id: string) =>
    guardAsync(async () => {
      // Acquiring a community style: always re-check first.
      await requireLicenseFresh('styles-community', 0)
      return downloadStyleFromIndex(id, (received, total) =>
        broadcastStylesProgress(id, received, total)
      )
    })
  )
  ipcMain.handle('styles:remove', (_e, adapterId: string) =>
    guardAsync(async () => {
      await removeAdapter(adapterId)
      return null
    })
  )
}
