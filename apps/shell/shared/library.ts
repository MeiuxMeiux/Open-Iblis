// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Library metadata types shared between main and the renderer. Split from
// contract.ts to keep that hub under its size cap; contract.ts re-exports
// these so existing imports keep working.

import type { GenerateConfig } from '@iblis/plugin-sdk'
import type { WavFacts } from './media'
import type { DetectedTrackFacts } from './processors'

// A library track as the renderer sees it: metadata only, never a filesystem
// path — audio streams through iblis-track://<id>, files are reached via the
// reveal/dragOut verbs. Full schema (docs/feature/library.md) lives in main.
export interface LibraryTrack {
  id: string
  name: string
  prompt: string
  createdAt: number // epoch ms
  rating: -1 | 0 | 1
  format: string
  tags: string[]
  folderId?: string
  requestedDurationSec?: number
  durationSec?: number
  audio?: WavFacts
  preset?: string
  seed?: number
  lyrics?: string
  // Stable host generation correlation used to keep blind comparison state
  // attached before/without a terminal JobResult. It is not a filesystem id.
  generationJobId?: string
  // Steering knobs the generation ran with, so Remix restores them exactly.
  config?: GenerateConfig
  // Detected audio facts from the current default analysis providers —
  // measured values, never generation targets (those live under config).
  detected?: DetectedTrackFacts
}

// Path-free organizer metadata. The first Library UI presents top-level
// folders; parentId remains additive groundwork for the documented tree.
export interface LibraryFolder {
  id: string
  parentId?: string
  name: string
  createdAt: number
  sortOrder: number
}

export interface LibraryOrganizerSnapshot {
  tracks: LibraryTrack[]
  folders: LibraryFolder[]
}

// A prompt-history entry (Create view recall). Starred prompts pin to the top
// and survive clear-all; history is metadata only — deleting it never touches
// tracks or audio.
export interface LibraryPrompt {
  id: string
  text: string
  lastUsedAt: number
  useCount: number
  starred: boolean
}
