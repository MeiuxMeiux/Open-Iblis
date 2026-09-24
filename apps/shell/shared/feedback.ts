// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { IpcResult } from './contract'

// Feedback entry points (docs/planning/2026-09-24-open-source/08-quality-
// program.md Q5). The renderer only names the kind; main builds the website
// URL itself and opens it in the system browser.
export type FeedbackKind = 'bug' | 'feature' | 'question'

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'feature', 'question']

export interface FeedbackApi {
  feedback: {
    // The latest diagnostics reference this install sent, or null.
    lastDiagRef: () => Promise<IpcResult<string | null>>
    // Open the website form. attachDiag adds the latest reference when one
    // exists; the result says whether it was attached.
    open: (kind: FeedbackKind, attachDiag: boolean) => Promise<IpcResult<{ diagAttached: boolean }>>
  }
}
