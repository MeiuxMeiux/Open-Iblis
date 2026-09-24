// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { ipcMain } from 'electron'
import type { MediaObservation } from '../../shared/contract'
import {
  listTracks,
  getTrackDetail,
  renameTrack,
  rateTrack,
  listFolders,
  createFolder,
  renameFolder,
  removeFolder,
  moveTrackToFolder,
  deleteTrack,
  revealTrack,
  startTrackDrag,
  listPrompts,
  starPrompt,
  removePrompt,
  clearPrompts,
  getTrackAnalysis,
  recordMediaObservation
} from './library'
import { guardAsync } from './ipc-guard'

export function registerLibraryIpc(): void {
  ipcMain.handle('library:list', () => guardAsync(listTracks))
  ipcMain.handle('library:detail', (_e, id: string, includeAnalysis?: boolean) =>
    guardAsync(() => getTrackDetail(id, includeAnalysis))
  )
  ipcMain.handle('library:rename', (_e, id: string, name: string) =>
    guardAsync(() => renameTrack(id, name))
  )
  ipcMain.handle('library:rate', (_e, id: string, rating: -1 | 0 | 1) =>
    guardAsync(() => rateTrack(id, rating))
  )
  ipcMain.handle('library:folders', () => guardAsync(listFolders))
  ipcMain.handle('library:folder-create', (_e, name: string) =>
    guardAsync(() => createFolder(name))
  )
  ipcMain.handle('library:folder-rename', (_e, id: string, name: string) =>
    guardAsync(() => renameFolder(id, name))
  )
  ipcMain.handle('library:folder-remove', (_e, id: string) => guardAsync(() => removeFolder(id)))
  ipcMain.handle('library:move-to-folder', (_e, id: string, folderId?: string) =>
    guardAsync(() => moveTrackToFolder(id, folderId))
  )
  ipcMain.handle('library:remove', (_e, id: string) =>
    guardAsync(async () => {
      await deleteTrack(id)
      return null
    })
  )
  ipcMain.handle('library:reveal', (_e, id: string) =>
    guardAsync(async () => {
      await revealTrack(id)
      return null
    })
  )
  ipcMain.handle('library:dragOut', (e, id: string) =>
    guardAsync(async () => {
      await startTrackDrag(e.sender, id)
      return null
    })
  )
  ipcMain.handle('library:prompts', () => guardAsync(listPrompts))
  ipcMain.handle('library:prompt-star', (_e, id: string, starred: boolean) =>
    guardAsync(() => starPrompt(id, starred))
  )
  ipcMain.handle('library:prompt-remove', (_e, id: string) =>
    guardAsync(async () => {
      await removePrompt(id)
      return null
    })
  )
  ipcMain.handle('library:prompts-clear', () => guardAsync(clearPrompts))
  ipcMain.handle('library:analysis', (_e, id: string) => guardAsync(() => getTrackAnalysis(id)))
  ipcMain.handle('library:media-observed', (_e, id: string, observation: MediaObservation) =>
    guardAsync(async () => {
      await recordMediaObservation(id, observation)
      return null
    })
  )
}
