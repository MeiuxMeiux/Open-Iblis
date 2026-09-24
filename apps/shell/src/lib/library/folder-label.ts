// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

const VIRTUAL_FOLDER_NAMES = new Set(['all tracks', 'no folder'])

// Alpha builds allowed user folders to take the two virtual filter names.
// Keep those records intact, but make every renderer surface unambiguous.
export function folderDisplayName(name: string): string {
  return VIRTUAL_FOLDER_NAMES.has(name.toLocaleLowerCase()) ? `${name} (user folder)` : name
}
