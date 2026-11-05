// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Feedback entry points (Settings -> Feedback, the titlebar button, the Help
// menu, and "Report this" on error messages) all open the website form in
// the system browser through openFeedbackForm. Opening a page sends nothing
// on the app's behalf; the user reads the form, including the system line,
// and decides whether to submit it. URL rules live in feedback-url.ts.

import { release } from 'node:os'
import { app, ipcMain, shell } from 'electron'
import { lastDiagRef } from './diag'
import { feedbackUrl, isFeedbackKind, osLabel, systemLine } from './feedback-url'
import { probeHardware, summarizeHardware } from './hardware/probe'
import { guard, guardAsync } from './ipc-guard'
import { log } from './logger'
import { buildKind } from './official-endpoints'
import type { FeedbackKind } from '../../shared/feedback'

// The probe runs a few short system commands; one result per app run is
// enough (hardware does not change under a running app).
let systemPromise: Promise<string | null> | null = null

function systemSummary(): Promise<string | null> {
  systemPromise ??= probeHardware()
    .then((report) =>
      systemLine({
        platform: process.platform,
        osVersion: process.platform === 'darwin' ? process.getSystemVersion() : release(),
        arch: report.rosetta ? `${report.arch} (Rosetta 2)` : report.arch,
        cpu: report.cpu,
        memoryMb: report.memoryMb,
        gpu: summarizeHardware(report)
      })
    )
    .catch((err: unknown) => {
      log('warn', 'feedback: hardware probe failed', { error: String(err) })
      return null
    })
  return systemPromise
}

export async function openFeedbackForm(
  kind: FeedbackKind,
  attachDiag: boolean
): Promise<{ diagAttached: boolean }> {
  if (!isFeedbackKind(kind)) throw new Error('unknown feedback kind')
  const diagRef = attachDiag ? lastDiagRef() : null
  const url = feedbackUrl(kind, {
    version: app.getVersion(),
    build: buildKind(),
    os: osLabel(process.platform, release()),
    diagRef,
    system: await systemSummary()
  })
  await shell.openExternal(url)
  log('info', 'feedback form opened', { kind, diagAttached: diagRef !== null })
  return { diagAttached: diagRef !== null }
}

export function registerFeedbackIpc(): void {
  ipcMain.handle('feedback:last-diag-ref', () => guard(lastDiagRef))
  ipcMain.handle('feedback:open', (_e, kind: unknown, attachDiag: unknown) =>
    guardAsync(async () => {
      if (!isFeedbackKind(kind)) throw new Error('unknown feedback kind')
      return openFeedbackForm(kind, attachDiag === true)
    })
  )
}
