// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The library store: every track Iblis has produced or imported, persisted as
// a single JSON document. This is the LibraryStore seam from
// docs/feature/library.md — the schema mirrors the SQLite design (tracks now;
// folders/prompts carried in the same typed document) so a later better-sqlite3
// swap is mechanical. JSON instead of SQLite is a
// recorded deviation: a native module can only be proven inside the Windows
// installer CI job, and a failed native load would brick the shell at startup.
//
// All side effects are injected (file path, clock, randomness) so the store
// unit-tests headlessly. Every mutation persists atomically (tmp + rename).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { GenerateConfig } from '@iblis/plugin-sdk'
import type { WavFacts } from '../../../shared/contract'
import {
  assignTrackFolder,
  deleteFolder,
  insertFolder,
  normalizeFolders,
  sortFolders,
  updateFolderName,
  type FolderRecord
} from './folders'
import {
  clearUnstarredPrompts,
  deletePrompt,
  recordPrompt,
  sortPrompts,
  updatePromptStar,
  type PromptRecord
} from './prompts'
import { deriveTrackName, makeUlid } from './identity'
import { ignoreFailure } from '../ignore-failure'

export type { PromptRecord } from './prompts'
export { deriveTrackName, makeUlid } from './identity'

type Rating = -1 | 0 | 1

// Mirrors the tracks table in library.md. `name` and `seed` are additive
// columns on top of the doc's schema (recorded there): name is the rename-in-
// place metadata, seed is what Remix needs to reproduce a generation.
export interface TrackRecord {
  id: string // ulid, lowercase (used as an iblis-track:// hostname)
  createdAt: number
  updatedAt: number
  name: string
  prompt: string
  lyrics?: string
  requestedDurationSec?: number
  durationSec?: number
  audio?: WavFacts
  filePath: string // absolute, inside the tracks root
  coverPath?: string
  format: string // 'wav' | 'mp3' | 'flac'
  preset?: string
  enginePluginId?: string
  enginePluginVersion?: string
  // Stable host-job correlation. Blind comparison masking must survive the
  // interval before JobState.result is published and any later restart.
  generationJobId?: string
  seed?: number
  // Additive column (alpha.8): the steering knobs the generation ran with
  // (negative prompt, bpm, steps, ...) so Remix reproduces the exact settings.
  config?: GenerateConfig
  rating: Rating
  folderId?: string
  tags: string[]
}

interface LibraryData {
  version: 1
  tracks: TrackRecord[]
  folders: FolderRecord[]
  prompts: PromptRecord[]
}

interface Mutation<T> {
  value: T
  changed: boolean
}

interface FolderRemoval {
  removed: FolderRecord
  tracks: TrackRecord[]
  folders: FolderRecord[]
}

function clone<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as T
}

interface NewTrack {
  id?: string // pre-minted via mintId() when the file layout needs it first
  createdAt?: number // imports keep the file's mtime so ordering survives
  name?: string // defaults to deriveTrackName(prompt, seed)
  prompt: string
  lyrics?: string
  requestedDurationSec?: number
  durationSec?: number
  audio?: WavFacts
  filePath: string
  format: string
  preset?: string
  enginePluginId?: string
  enginePluginVersion?: string
  generationJobId?: string
  seed?: number
  config?: GenerateConfig
  tags?: string[]
}

export interface StoreDeps {
  file: string // absolute path of the JSON document
  now?: () => number
  randomBytes?: (n: number) => Uint8Array
  // Test seam for transient reads. The path remains owned by this adapter.
  readDocument?: () => Promise<string>
  // Test seam for delayed/failing persistence. Production uses tmp + rename.
  writeDocument?: (serialized: string) => Promise<void>
}

export interface LibraryStore {
  list(): Promise<TrackRecord[]> // newest first
  get(id: string): Promise<TrackRecord | undefined>
  add(input: NewTrack): Promise<TrackRecord>
  rename(id: string, name: string): Promise<TrackRecord>
  rate(id: string, rating: Rating): Promise<TrackRecord>
  moveToFolder(id: string, folderId?: string): Promise<TrackRecord>
  // Removes the row only — the caller owns the file's fate.
  remove(id: string): Promise<TrackRecord | undefined>
  mintId(): string
  listFolders(): Promise<FolderRecord[]>
  createFolder(name: string): Promise<FolderRecord>
  renameFolder(id: string, name: string): Promise<FolderRecord>
  // Removes only organizer metadata. Assigned tracks move to No folder.
  removeFolder(id: string): Promise<FolderRemoval>
  // Prompt history. recordPromptUse dedups on normalized text; the rest keep
  // history cleanable: per-entry delete + clear-all that spares starred.
  recordPromptUse(text: string): Promise<PromptRecord>
  listPrompts(): Promise<PromptRecord[]> // starred first, then most recent
  starPrompt(id: string, starred: boolean): Promise<PromptRecord>
  removePrompt(id: string): Promise<void>
  clearPrompts(): Promise<number> // deletes every unstarred prompt
}

export function createLibraryStore(deps: StoreDeps): LibraryStore {
  const now = deps.now ?? Date.now
  const randomBytes = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)))
  const readDocument = deps.readDocument ?? (() => readFile(deps.file, 'utf8'))
  const writeDocument =
    deps.writeDocument ??
    (async (serialized: string): Promise<void> => {
      await mkdir(dirname(deps.file), { recursive: true })
      const tmp = `${deps.file}.tmp`
      await writeFile(tmp, serialized, 'utf8')
      await rename(tmp, deps.file)
    })

  let data: LibraryData | null = null
  let loadRun: Promise<LibraryData> | null = null
  let mutationChain = Promise.resolve()

  async function readData(): Promise<LibraryData> {
    let raw: string
    try {
      raw = await readDocument()
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
      data = { version: 1, tracks: [], folders: [], prompts: [] }
      return data
    }

    try {
      const parsed = JSON.parse(raw) as LibraryData | null
      if (parsed?.version !== 1 || !Array.isArray(parsed.tracks)) throw new Error('bad shape')
      parsed.folders = normalizeFolders(parsed.folders)
      if (!Array.isArray(parsed.prompts)) parsed.prompts = []
      const folderIds = new Set(parsed.folders.map((folder) => folder.id))
      for (const track of parsed.tracks) {
        if (track.folderId && !folderIds.has(track.folderId)) delete track.folderId
      }
      data = parsed
    } catch {
      // Corrupt document: keep the bytes for forensics, start fresh. Losing
      // metadata is recoverable (audio files are untouched); crashing the
      // library forever on one bad write is not.
      await rename(deps.file, `${deps.file}.corrupt`).catch(ignoreFailure)
      data = { version: 1, tracks: [], folders: [], prompts: [] }
    }
    return data
  }

  function load(): Promise<LibraryData> {
    if (data) return Promise.resolve(data)
    loadRun ??= readData().finally(() => {
      loadRun = null
    })
    return loadRun
  }

  function mutate<T>(operation: (draft: LibraryData) => Mutation<T>): Promise<T> {
    const result = mutationChain.then(async () => {
      const draft = clone(await load())
      const mutation = operation(draft)
      if (mutation.changed) {
        await writeDocument(JSON.stringify(draft, null, 1))
        data = draft
      }
      return clone(mutation.value)
    })
    mutationChain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  function mustGet(draft: LibraryData, id: string): TrackRecord {
    const track = draft.tracks.find((candidate) => candidate.id === id)
    if (!track) throw new Error(`unknown track ${id}`)
    return track
  }

  return {
    async list(): Promise<TrackRecord[]> {
      const d = await load()
      return clone([...d.tracks].sort((a, b) => b.createdAt - a.createdAt))
    },

    async get(id: string): Promise<TrackRecord | undefined> {
      return clone((await load()).tracks.find((track) => track.id === id))
    },

    add(input: NewTrack): Promise<TrackRecord> {
      const value = clone(input)
      return mutate((draft) => {
        const at = value.createdAt ?? now()
        const track: TrackRecord = {
          id: value.id ?? makeUlid(now(), randomBytes(16)),
          createdAt: at,
          updatedAt: at,
          name: value.name ?? deriveTrackName(value.prompt, value.seed),
          prompt: value.prompt,
          ...(value.lyrics !== undefined ? { lyrics: value.lyrics } : {}),
          ...(value.requestedDurationSec !== undefined
            ? { requestedDurationSec: value.requestedDurationSec }
            : {}),
          ...(value.durationSec !== undefined ? { durationSec: value.durationSec } : {}),
          ...(value.audio !== undefined ? { audio: value.audio } : {}),
          filePath: value.filePath,
          format: value.format,
          ...(value.preset !== undefined ? { preset: value.preset } : {}),
          ...(value.enginePluginId !== undefined ? { enginePluginId: value.enginePluginId } : {}),
          ...(value.enginePluginVersion !== undefined
            ? { enginePluginVersion: value.enginePluginVersion }
            : {}),
          ...(value.generationJobId !== undefined
            ? { generationJobId: value.generationJobId }
            : {}),
          ...(value.seed !== undefined ? { seed: value.seed } : {}),
          ...(value.config !== undefined ? { config: value.config } : {}),
          rating: 0,
          tags: value.tags ?? []
        }
        draft.tracks.push(track)
        return { value: track, changed: true }
      })
    },

    rename(id: string, name: string): Promise<TrackRecord> {
      return mutate((draft) => {
        const track = mustGet(draft, id)
        const trimmed = name.trim()
        if (!trimmed) return { value: track, changed: false }
        track.name = trimmed
        track.updatedAt = now()
        return { value: track, changed: true }
      })
    },

    rate(id: string, rating: Rating): Promise<TrackRecord> {
      return mutate((draft) => {
        const track = mustGet(draft, id)
        track.rating = rating
        track.updatedAt = now()
        return { value: track, changed: true }
      })
    },

    moveToFolder(id: string, folderId?: string): Promise<TrackRecord> {
      return mutate((draft) => {
        const track = mustGet(draft, id)
        const changed = assignTrackFolder(draft.folders, track, folderId, now())
        return { value: track, changed }
      })
    },

    remove(id: string): Promise<TrackRecord | undefined> {
      return mutate((draft) => {
        const index = draft.tracks.findIndex((track) => track.id === id)
        if (index === -1) return { value: undefined, changed: false }
        const [gone] = draft.tracks.splice(index, 1)
        return { value: gone, changed: true }
      })
    },

    mintId(): string {
      return makeUlid(now(), randomBytes(16))
    },

    async listFolders(): Promise<FolderRecord[]> {
      return clone(sortFolders((await load()).folders))
    },

    createFolder(value: string): Promise<FolderRecord> {
      return mutate((draft) => {
        const at = now()
        const folder = insertFolder(draft.folders, value, makeUlid(at, randomBytes(16)), at)
        return { value: folder, changed: true }
      })
    },

    renameFolder(id: string, value: string): Promise<FolderRecord> {
      return mutate((draft) => {
        const result = updateFolderName(draft.folders, id, value)
        return { value: result.folder, changed: result.changed }
      })
    },

    removeFolder(id: string): Promise<FolderRemoval> {
      return mutate((draft) => {
        const removed = deleteFolder(draft.folders, draft.tracks, id, now())
        return {
          value: {
            removed,
            tracks: [...draft.tracks].sort((a, b) => b.createdAt - a.createdAt),
            folders: sortFolders(draft.folders)
          },
          changed: true
        }
      })
    },

    recordPromptUse(text: string): Promise<PromptRecord> {
      return mutate((draft) => {
        const at = now()
        const prompt = recordPrompt(draft.prompts, text, at, () => makeUlid(at, randomBytes(16)))
        return { value: prompt, changed: true }
      })
    },

    async listPrompts(): Promise<PromptRecord[]> {
      return clone(sortPrompts((await load()).prompts))
    },

    starPrompt(id: string, starred: boolean): Promise<PromptRecord> {
      return mutate((draft) => ({
        value: updatePromptStar(draft.prompts, id, starred),
        changed: true
      }))
    },

    removePrompt(id: string): Promise<void> {
      return mutate((draft) => ({ value: undefined, changed: deletePrompt(draft.prompts, id) }))
    },

    clearPrompts(): Promise<number> {
      return mutate((draft) => {
        const removed = clearUnstarredPrompts(draft.prompts)
        return { value: removed, changed: removed > 0 }
      })
    }
  }
}
