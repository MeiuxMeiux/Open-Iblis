// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Renderer-facing projections of stored library records. Split from index.ts
// to keep the Electron adapter under its size cap. Nothing here touches disk:
// these map already-loaded records to the path-free shared contract.

import type { LibraryFolder, LibraryPrompt, LibraryTrack } from '../../../shared/contract'
import type { PromptRecord, TrackRecord } from './store'
import type { FolderRecord } from './folders'
import { detectedFactsForTrack } from '../processors'

export function toRendererTrack(t: TrackRecord): LibraryTrack {
  return {
    id: t.id,
    name: t.name,
    prompt: t.prompt,
    createdAt: t.createdAt,
    rating: t.rating,
    format: t.format,
    tags: t.tags,
    ...(t.folderId !== undefined ? { folderId: t.folderId } : {}),
    ...(t.requestedDurationSec !== undefined
      ? { requestedDurationSec: t.requestedDurationSec }
      : {}),
    ...(t.durationSec !== undefined ? { durationSec: t.durationSec } : {}),
    ...(t.audio !== undefined ? { audio: t.audio } : {}),
    ...(t.preset !== undefined ? { preset: t.preset } : {}),
    ...(t.seed !== undefined ? { seed: t.seed } : {}),
    ...(t.lyrics !== undefined ? { lyrics: t.lyrics } : {}),
    ...(t.config !== undefined ? { config: t.config } : {}),
    ...(t.generationJobId !== undefined ? { generationJobId: t.generationJobId } : {})
  }
}

export function toRendererFolder(folder: FolderRecord): LibraryFolder {
  return {
    id: folder.id,
    name: folder.name,
    createdAt: folder.createdAt,
    sortOrder: folder.sortOrder,
    ...(folder.parentId ? { parentId: folder.parentId } : {})
  }
}

// Single-track responses (rename/rate/move) reattach detected facts so a row
// patch in the renderer never silently drops its badges.
export function withDetectedFacts(track: LibraryTrack): LibraryTrack {
  const detected = detectedFactsForTrack(track.id)
  return detected ? { ...track, detected } : track
}

export function toRendererPrompt(p: PromptRecord): LibraryPrompt {
  return {
    id: p.id,
    text: p.text,
    lastUsedAt: p.lastUsedAt,
    useCount: p.useCount,
    starred: p.starred
  }
}
