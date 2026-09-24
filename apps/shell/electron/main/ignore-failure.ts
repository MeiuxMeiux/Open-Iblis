// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Rejection handler for best-effort side work: cleanup of temp files, lease
// releases, upstream cancels, and fire-and-forget bookkeeping. Callers use it
// where the failure is harmless or already reported by the primary path, and
// must not replace the outcome the caller is about to return or throw.
export function ignoreFailure(): void {
  // Deliberately empty.
}
