// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The application menu. Electron's default menu is kept role for role (so
// copy/paste, reload, and window shortcuts behave exactly as before), except
// that Help now holds the feedback entry points instead of Electron's own
// "Learn More" links. On macOS the menu bar is visible; on Windows the window
// is frameless, so the same entries also live on the titlebar button and in
// Settings -> Feedback.

import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { FeedbackKind } from '../../shared/feedback'
import { openFeedbackForm } from './ipc-feedback'
import { log } from './logger'

function feedbackItem(label: string, kind: FeedbackKind): MenuItemConstructorOptions {
  return {
    label,
    click: () => {
      // The menu never attaches a diagnostics reference by itself; the
      // Settings panel offers that choice explicitly.
      openFeedbackForm(kind, false).catch((err: unknown) => {
        log('warn', 'feedback form from the menu failed', { kind, error: String(err) })
      })
    }
  }
}

function helpMenu(): MenuItemConstructorOptions {
  return {
    role: 'help',
    submenu: [
      feedbackItem('Report a Bug...', 'bug'),
      feedbackItem('Request a Feature...', 'feature'),
      feedbackItem('Ask a Question...', 'question')
    ]
  }
}

function menuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    helpMenu()
  ]
}

export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(process.platform)))
}
