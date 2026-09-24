// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

const MAX_FOLDER_NAME_LENGTH = 80

export interface FolderRecord {
  id: string
  parentId?: string
  name: string
  createdAt: number
  sortOrder: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function folderName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('folder name is required')
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    throw new Error(`folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer`)
  }
  return name
}

function userFolderName(value: string): string {
  const name = folderName(value)
  if (['all tracks', 'no folder'].includes(name.toLocaleLowerCase())) {
    throw new Error(`"${name}" is reserved by the Library`)
  }
  return name
}

// Folder records were an untyped placeholder before the first organizer UI.
// Repair malformed/orphaned legacy values at the store boundary so no unknown
// data crosses IPC. Cycles are flattened deterministically at their first edge.
export function normalizeFolders(value: unknown): FolderRecord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const folders: FolderRecord[] = []

  for (const candidate of value) {
    if (!isRecord(candidate)) continue
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const rawName = typeof candidate.name === 'string' ? candidate.name : ''
    const createdAt = candidate.createdAt
    const sortOrder = candidate.sortOrder
    if (!id || seen.has(id) || typeof createdAt !== 'number' || !Number.isFinite(createdAt))
      continue
    if (typeof sortOrder !== 'number' || !Number.isSafeInteger(sortOrder) || sortOrder < 0) continue
    let name: string
    try {
      name = folderName(rawName)
    } catch {
      continue
    }
    const parentId =
      typeof candidate.parentId === 'string' && candidate.parentId.trim()
        ? candidate.parentId.trim()
        : undefined
    seen.add(id)
    folders.push({ id, name, createdAt, sortOrder, ...(parentId ? { parentId } : {}) })
  }

  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  for (const folder of folders) {
    if (!folder.parentId || folder.parentId === folder.id || !byId.has(folder.parentId)) {
      delete folder.parentId
      continue
    }
    const ancestry = new Set([folder.id])
    let parentId: string | undefined = folder.parentId
    while (parentId) {
      if (ancestry.has(parentId)) {
        delete folder.parentId
        break
      }
      ancestry.add(parentId)
      parentId = byId.get(parentId)?.parentId
    }
  }
  return compactFolderOrder(folders)
}

export function sortFolders(folders: FolderRecord[]): FolderRecord[] {
  return [...folders].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.createdAt - b.createdAt
  )
}

function compactFolderOrder(folders: FolderRecord[]): FolderRecord[] {
  const ordered = sortFolders(folders)
  ordered.forEach((folder, index) => {
    folder.sortOrder = index
  })
  return ordered
}

function assertUniqueFolderName(folders: FolderRecord[], name: string, exceptId?: string): void {
  const key = name.toLocaleLowerCase()
  if (folders.some((folder) => folder.id !== exceptId && folder.name.toLocaleLowerCase() === key)) {
    throw new Error(`a folder named "${name}" already exists`)
  }
}

interface FolderTrack {
  folderId?: string
  updatedAt: number
}

export function insertFolder(
  folders: FolderRecord[],
  value: string,
  id: string,
  createdAt: number
): FolderRecord {
  const name = userFolderName(value)
  assertUniqueFolderName(folders, name)
  const ordered = sortFolders(folders)
  const last = ordered[ordered.length - 1]
  const sortOrder =
    last?.sortOrder === Number.MAX_SAFE_INTEGER
      ? compactFolderOrder(folders).length
      : (last?.sortOrder ?? -1) + 1
  const folder: FolderRecord = {
    id,
    name,
    createdAt,
    sortOrder
  }
  folders.push(folder)
  return folder
}

export function updateFolderName(
  folders: FolderRecord[],
  id: string,
  value: string
): { folder: FolderRecord; changed: boolean } {
  const folder = folders.find((item) => item.id === id)
  if (!folder) throw new Error(`unknown folder ${id}`)
  const name = userFolderName(value)
  assertUniqueFolderName(folders, name, id)
  if (folder.name === name) return { folder, changed: false }
  folder.name = name
  return { folder, changed: true }
}

export function deleteFolder(
  folders: FolderRecord[],
  tracks: FolderTrack[],
  id: string,
  updatedAt: number
): FolderRecord {
  const index = folders.findIndex((folder) => folder.id === id)
  if (index === -1) throw new Error(`unknown folder ${id}`)
  const [folder] = folders.splice(index, 1)
  if (!folder) throw new Error(`unknown folder ${id}`)
  for (const child of folders) {
    if (child.parentId !== id) continue
    if (folder.parentId) child.parentId = folder.parentId
    else delete child.parentId
  }
  for (const track of tracks) {
    if (track.folderId !== id) continue
    delete track.folderId
    track.updatedAt = updatedAt
  }
  return folder
}

export function assignTrackFolder(
  folders: FolderRecord[],
  track: FolderTrack,
  folderId: string | undefined,
  updatedAt: number
): boolean {
  if (folderId && !folders.some((folder) => folder.id === folderId)) {
    throw new Error(`unknown folder ${folderId}`)
  }
  if (track.folderId === folderId) return false
  if (folderId) track.folderId = folderId
  else delete track.folderId
  track.updatedAt = updatedAt
  return true
}
