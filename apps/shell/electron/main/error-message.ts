// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The one way main-process code turns a caught value into text for logs and
// IpcResult errors: an Error-like value's message, else the value itself.
// Rejections are untyped, so null, strings and plain objects are all handled.
export function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message
  return String(message ?? error)
}
