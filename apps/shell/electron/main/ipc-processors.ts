// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, ipcMain } from 'electron'
import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
import {
  acknowledgeProcessorProvider,
  exportProcessorBenchmark,
  processorBenchmarks,
  processorProviderDetail,
  processorResults,
  processorSettings,
  retryProcessorAnalysis,
  setProcessorDefault,
  queueProcessorBenchmark
} from './processors'
import { guard, guardAsync } from './ipc-guard'

// Renderer arguments are untrusted even when the preload types them. Coerce
// exactly like String(), with null/undefined mapping to ''.
function stringArg(value: unknown): string {
  const present: unknown = value ?? ''
  return String(present)
}

export function registerProcessorIpc(): void {
  ipcMain.handle('processors:settings', () => guard(processorSettings))
  ipcMain.handle('processors:detail', (_e, id: unknown) =>
    guard(() => processorProviderDetail(stringArg(id)))
  )
  ipcMain.handle('processors:acknowledge', (_e, id: unknown) =>
    guardAsync(() => acknowledgeProcessorProvider(stringArg(id)))
  )
  ipcMain.handle(
    'processors:set-default',
    (_e, capability: ProcessorAnalysisCapability, pluginId?: string) =>
      guardAsync(() => setProcessorDefault(capability, pluginId))
  )
  ipcMain.handle('processors:results', (_e, trackId: string) =>
    guard(() => processorResults(trackId))
  )
  ipcMain.handle('processors:benchmarks', () => guard(processorBenchmarks))
  ipcMain.handle('processors:benchmark', (_e, trackId: unknown, providerIds: unknown) =>
    guardAsync(() =>
      queueProcessorBenchmark(
        stringArg(trackId),
        Array.isArray(providerIds) ? providerIds.map((id: unknown) => String(id)) : []
      )
    )
  )
  ipcMain.handle('processors:export-benchmark', (event, id: unknown) =>
    guardAsync(() =>
      exportProcessorBenchmark(stringArg(id), BrowserWindow.fromWebContents(event.sender))
    )
  )
  ipcMain.handle(
    'processors:retry',
    (_e, trackId: string, capability: ProcessorAnalysisCapability) =>
      guardAsync(async () => {
        await retryProcessorAnalysis(trackId, capability)
        return null
      })
  )
}
