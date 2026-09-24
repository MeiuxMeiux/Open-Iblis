// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Paths are exposed only to the user-requested Settings storage picker, never
// through the ordinary library or plugin data boundaries.
export interface StorageLocation {
  dataPath: string
  defaultPath: string
  pendingDataPath?: string
}
