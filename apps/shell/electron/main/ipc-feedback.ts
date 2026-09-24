// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Settings -> Feedback: opens the website form in the system browser. Opening
// a page sends nothing on the app's behalf; the user reads the form and
// decides whether to submit it. URL rules live in feedback-url.ts.

import { release } from 'node:os'
import { app, ipcMain, shell } from 'electron'
import { lastDiagRef } from './diag'
import { feedbackUrl, isFeedbackKind, osLabel } from './feedback-url'
import { guard, guardAsync } from './ipc-guard'
import { log } from './logger'
import { buildKind } from './official-endpoints'

export function registerFeedbackIpc(): void {
  ipcMain.handle('feedback:last-diag-ref', () => guard(lastDiagRef))
  ipcMain.handle('feedback:open', (_e, kind: unknown, attachDiag: unknown) =>
    guardAsync(async () => {
      if (!isFeedbackKind(kind)) throw new Error('unknown feedback kind')
      const diagRef = attachDiag === true ? lastDiagRef() : null
      const url = feedbackUrl(kind, {
        version: app.getVersion(),
        build: buildKind(),
        os: osLabel(process.platform, release()),
        diagRef
      })
      await shell.openExternal(url)
      log('info', 'feedback form opened', { kind, diagAttached: diagRef !== null })
      return { diagAttached: diagRef !== null }
    })
  )
}
