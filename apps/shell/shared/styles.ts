// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Renderer-facing community-trainings index types. Entries cross the IPC
// boundary without URLs or origin hashes — downloads happen by id in main.

import type { TrainingCategory } from './training'

export interface StyleIndexEntryView {
  id: string
  name: string
  version: number
  categories: TrainingCategory[]
  tags: string[]
  bytes: number
  downloadCount: number
  hasPreview: boolean
  createdAt: string
  updatedAt: string
  // True when this install authored the training (origin-hash match).
  yours: boolean
  // Set when the entry is already in the local adapter library.
  installedAdapterId?: string
}

export interface StylesIndexView {
  entries: StyleIndexEntryView[]
  fetchedAt: number
  // True when entries came from the verified offline cache, not the network.
  fromCache: boolean
}

export interface StylesDownloadProgress {
  id: string
  received: number
  total: number
  percent: number
}

// The pinned engine loads one adapter at a time (upstream musician guide;
// repo audit 2026-07-13). The UI models N so a future multi-adapter engine
// pack only changes this constant and its proof.
export const MAX_ACTIVE_STYLES = 1

// The registry name a library record surfaces under in the engine's live
// /props list: slug of the display name plus a content-hash prefix. Shared
// so the picker and the generation adapter root can never disagree.
export function styleRegistryName(displayName: string, sha256: string): string {
  const cleaned = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${cleaned || 'style'}-${sha256.slice(0, 8)}`
}
