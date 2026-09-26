// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, ipcMain } from 'electron'
import { STEM_BACKENDS, type StemBackend } from '@iblis/plugin-sdk'
import type { StemSettings } from '../../shared/stems'
import {
  cancelStems,
  dragStem,
  exportStemSet,
  removeStemSet,
  revealStem,
  setStemSettings,
  splitTrack,
  stemsSnapshot,
  trackStems
} from './stems'
import { DRAG_ICON } from './library'
import { guardAsync } from './ipc-guard'

// Renderer arguments are untrusted even when the preload types them.
function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 128) : ''
}

function settingsPatch(value: unknown): Partial<StemSettings> {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  const patch: Partial<StemSettings> = {}
  if ((STEM_BACKENDS as readonly unknown[]).includes(input.backend))
    patch.backend = input.backend as StemBackend
  if ('defaultProvider' in input) patch.defaultProvider = text(input.defaultProvider)
  return patch
}

export function registerStemIpc(): void {
  ipcMain.handle('stems:snapshot', () => guardAsync(stemsSnapshot))
  ipcMain.handle('stems:set-settings', (_e, patch: unknown) =>
    guardAsync(() => setStemSettings(settingsPatch(patch)))
  )
  ipcMain.handle('stems:track', (_e, trackId: unknown) =>
    guardAsync(() => trackStems(text(trackId)))
  )
  ipcMain.handle('stems:split', (_e, trackId: unknown, providerId: unknown) =>
    guardAsync(() => splitTrack(text(trackId), text(providerId) || undefined))
  )
  ipcMain.handle('stems:cancel', (_e, trackId: unknown) =>
    guardAsync(() => cancelStems(text(trackId)))
  )
  ipcMain.handle('stems:remove', (_e, trackId: unknown, setId: unknown) =>
    guardAsync(() => removeStemSet(text(trackId), text(setId)))
  )
  ipcMain.handle('stems:reveal', (_e, trackId: unknown, setId: unknown, role: unknown) =>
    guardAsync(async () => {
      await revealStem(text(trackId), text(setId), role)
      return null
    })
  )
  ipcMain.handle('stems:drag-out', (event, trackId: unknown, setId: unknown, role: unknown) =>
    guardAsync(async () => {
      await dragStem(event.sender, text(trackId), text(setId), role, DRAG_ICON)
      return null
    })
  )
  ipcMain.handle('stems:export', (event, trackId: unknown, setId: unknown) =>
    guardAsync(() =>
      exportStemSet(text(trackId), text(setId), BrowserWindow.fromWebContents(event.sender))
    )
  )
}
