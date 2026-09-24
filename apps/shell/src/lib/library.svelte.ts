// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Renderer-side library state: the track list cache plus the Remix hand-off.
// Module-scope (like queue.svelte.ts) so the list survives view switches
// and the Remix prefill survives the Library -> Create navigation.

import type { GenerateRequest } from '@iblis/plugin-sdk'
import type { LibraryFolder, LibraryTrack } from '../../shared/contract'
import { player } from './player.svelte'
import { createRefreshExecutor, createSerialExecutor } from './library/serial-executor'

let tracks = $state<LibraryTrack[]>([])
let folders = $state<LibraryFolder[]>([])
let loaded = $state(false)
let error = $state<string | null>(null)
let removingIds = $state<string[]>([])
export type FolderFilter = { kind: 'all' } | { kind: 'none' } | { kind: 'folder'; id: string }
let folderFilter = $state<FolderFilter>({ kind: 'all' })
const enqueueState = createSerialExecutor()

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

// Set by Remix in the Library view, consumed once by the Create view on mount.
export type RemixPrefill = GenerateRequest
let remixPrefill: RemixPrefill | null = null

function apply(r: { ok: true; data: LibraryTrack } | { ok: false; error: string }): boolean {
  if (!r.ok) {
    error = r.error
    return false
  }
  const idx = tracks.findIndex((t) => t.id === r.data.id)
  if (idx !== -1) tracks[idx] = r.data
  player.updateTrack(r.data)
  error = null
  return true
}

function applyFolder(
  r: { ok: true; data: LibraryFolder } | { ok: false; error: string }
): LibraryFolder | null {
  if (!r.ok) {
    error = r.error
    return null
  }
  const index = folders.findIndex((folder) => folder.id === r.data.id)
  if (index === -1) folders = [...folders, r.data]
  else folders[index] = r.data
  folders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder)
  error = null
  return r.data
}

async function loadLibrary(): Promise<void> {
  try {
    const [trackResult, folderResult] = await Promise.all([
      window.iblis.library.list(),
      window.iblis.library.folders()
    ])
    if (trackResult.ok) {
      tracks = trackResult.data
      player.updateTracks(trackResult.data)
    }
    if (folderResult.ok) folders = folderResult.data
    error = !trackResult.ok ? trackResult.error : !folderResult.ok ? folderResult.error : null
    const currentFilter = folderFilter
    if (
      currentFilter.kind === 'folder' &&
      !folders.some((folder) => folder.id === currentFilter.id)
    ) {
      folderFilter = { kind: 'all' }
    }
  } catch (cause) {
    error = message(cause)
  }
  loaded = true
}

const refreshLibrary = createRefreshExecutor(loadLibrary, enqueueState)

export const library = {
  get tracks(): LibraryTrack[] {
    return tracks
  },
  get folders(): LibraryFolder[] {
    return folders
  },
  get folderFilter(): FolderFilter {
    return folderFilter
  },
  get loaded(): boolean {
    return loaded
  },
  get error(): string | null {
    return error
  },
  isRemoving(id: string): boolean {
    return removingIds.includes(id)
  },

  async refresh(): Promise<void> {
    return refreshLibrary()
  },

  selectFolder(filter: FolderFilter): void {
    folderFilter = filter
  },

  async rename(id: string, name: string): Promise<string | null> {
    if (removingIds.includes(id)) return 'Track is being deleted.'
    return enqueueState(async () => {
      try {
        const result = await window.iblis.library.rename(id, name)
        if (!result.ok) return result.error
        apply(result)
        return null
      } catch (cause) {
        return message(cause)
      }
    })
  },

  // Rating toggles: liking a liked track clears it back to 0.
  async rate(id: string, rating: -1 | 0 | 1): Promise<void> {
    if (removingIds.includes(id)) return
    return enqueueState(async () => {
      if (removingIds.includes(id)) return
      const current = tracks.find((t) => t.id === id)
      const next = current?.rating === rating ? 0 : rating
      try {
        apply(await window.iblis.library.rate(id, next))
      } catch (cause) {
        error = message(cause)
      }
    })
  },

  async createFolder(name: string): Promise<LibraryFolder | null> {
    return enqueueState(async () => {
      try {
        return applyFolder(await window.iblis.library.folderCreate(name))
      } catch (cause) {
        error = message(cause)
        return null
      }
    })
  },

  async renameFolder(id: string, name: string): Promise<string | null> {
    return enqueueState(async () => {
      try {
        const result = await window.iblis.library.folderRename(id, name)
        if (!result.ok) return result.error
        applyFolder(result)
        return null
      } catch (cause) {
        return message(cause)
      }
    })
  },

  async removeFolder(id: string): Promise<boolean> {
    return enqueueState(async () => {
      let result
      try {
        result = await window.iblis.library.folderRemove(id)
      } catch (cause) {
        error = message(cause)
        return false
      }
      if (!result.ok) {
        error = result.error
        return false
      }
      folders = result.data.folders
      tracks = result.data.tracks
      player.updateTracks(tracks)
      if (folderFilter.kind === 'folder' && folderFilter.id === id) {
        folderFilter = { kind: 'none' }
      }
      error = null
      return true
    })
  },

  async moveToFolder(id: string, folderId?: string): Promise<boolean> {
    if (removingIds.includes(id)) return false
    return enqueueState(async () => {
      if (removingIds.includes(id)) return false
      try {
        return apply(await window.iblis.library.moveToFolder(id, folderId))
      } catch (cause) {
        error = message(cause)
        return false
      }
    })
  },

  async remove(id: string): Promise<boolean> {
    if (removingIds.includes(id)) return false
    removingIds = [...removingIds, id]
    const selected = tracks.find((track) => track.id === id)
    const wasActive = player.activeId === id
    const unload = player.unloadIfActive(id)
    const restoreActiveTrack = (): void => {
      const current = tracks.find((track) => track.id === id) ?? selected
      if (wasActive && current && player.activeId === null) player.select(current, false)
    }
    try {
      return await enqueueState(async () => {
        try {
          await unload
        } catch (cause) {
          error = message(cause)
          restoreActiveTrack()
          return false
        }
        try {
          const result = await window.iblis.library.remove(id)
          if (!result.ok) {
            error = result.error
            restoreActiveTrack()
            return false
          }
          tracks = tracks.filter((track) => track.id !== id)
          player.updateTracks(tracks)
          error = null
          return true
        } catch (cause) {
          error = message(cause)
          restoreActiveTrack()
          return false
        }
      })
    } finally {
      removingIds = removingIds.filter((candidate) => candidate !== id)
    }
  },

  async reveal(id: string): Promise<void> {
    if (removingIds.includes(id)) return
    return enqueueState(async () => {
      if (removingIds.includes(id)) return
      try {
        const result = await window.iblis.library.reveal(id)
        if (!result.ok) error = result.error
        else error = null
      } catch (cause) {
        error = message(cause)
      }
    })
  },

  dragOut(id: string): void {
    if (removingIds.includes(id)) return
    void window.iblis.library.dragOut(id)
  },

  setRemix(prefill: RemixPrefill): void {
    remixPrefill = prefill
  },

  takeRemix(): RemixPrefill | null {
    const p = remixPrefill
    remixPrefill = null
    return p
  }
}
