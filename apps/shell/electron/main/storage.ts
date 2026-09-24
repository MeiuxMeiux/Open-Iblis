// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The Electron profile remains the small, reliable home for preferences,
// credentials, logs, and the pointer below. Large user-owned payloads live
// under a separately configurable root so an installer drive never dictates
// where models, audio, and training scratch consume space.

import { app, dialog, type BrowserWindow } from 'electron'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const SETTINGS_VERSION = 1
const SETTINGS_FILE = 'storage-location.json'
const MANAGED_ENTRIES = [
  'plugins',
  'tracks',
  'adapters',
  'training',
  'cache',
  'engine-compatibility'
]

interface StorageSettings {
  version: number
  dataPath?: string
  pendingDataPath?: string
}

export interface StorageLocation {
  dataPath: string
  defaultPath: string
  pendingDataPath?: string
}

function profilePath(): string {
  return app.getPath('userData')
}

function settingsPath(): string {
  return join(profilePath(), SETTINGS_FILE)
}

function readSettings(): StorageSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as StorageSettings
    if (parsed.version !== SETTINGS_VERSION) throw new Error('unsupported storage settings')
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT')
      return { version: SETTINGS_VERSION }
    throw new Error('storage location settings are unavailable', { cause: error })
  }
}

function writeSettings(settings: StorageSettings): void {
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8')
  renameSync(temp, file)
}

function contained(parent: string, child: string): boolean {
  const part = relative(parent, child)
  return part === '' || (!part.startsWith('..') && !isAbsolute(part))
}

function validTarget(source: string, target: string): void {
  if (source === target) throw new Error('This is already Iblis’s data location.')
  if (contained(source, target) || contained(target, source)) {
    throw new Error('Choose a folder outside the current Iblis data location.')
  }
}

function rewritePath(value: unknown, source: string, target: string): unknown {
  if (typeof value === 'string') {
    if (value === source) return target
    if (value.startsWith(source + sep)) return target + value.slice(source.length)
    return value
  }
  if (Array.isArray(value)) return value.map((item) => rewritePath(item, source, target))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewritePath(item, source, target)])
    )
  }
  return value
}

function rewriteStoredPaths(file: string, source: string, target: string): void {
  if (!existsSync(file)) return
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
  const rewritten = rewritePath(parsed, source, target)
  writeFileSync(file, JSON.stringify(rewritten, null, 2), 'utf8')
}

function moveEntry(source: string, target: string, entry: string): void {
  const from = join(source, entry)
  if (!existsSync(from)) return
  const to = join(target, entry)
  if (existsSync(to)) throw new Error(`The selected folder already contains Iblis ${entry} data.`)
  try {
    renameSync(from, to) // atomic when both locations share a volume
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'EXDEV') throw error
    // Separate drives need copy-then-remove. The original stays intact until
    // the copy has completed; a failed copy removes only its new partial tree.
    try {
      cpSync(from, to, { recursive: true, errorOnExist: true, preserveTimestamps: true })
    } catch (copyError) {
      rmSync(to, { recursive: true, force: true })
      throw copyError
    }
    rmSync(from, { recursive: true, force: true })
  }
}

function migrate(source: string, target: string): void {
  mkdirSync(target, { recursive: true })
  for (const entry of MANAGED_ENTRIES) moveEntry(source, target, entry)
  // Library and training documents intentionally keep their internal paths in
  // main only. Rebase them before the new root becomes authoritative.
  rewriteStoredPaths(join(target, 'tracks', 'library.json'), source, target)
  rewriteStoredPaths(join(target, 'training', 'jobs.json'), source, target)
}

// Must run before any subsystem creates a singleton rooted in heavyDataRoot().
export function prepareStorage(): void {
  const settings = readSettings()
  if (!settings.pendingDataPath) return
  const source = resolve(settings.dataPath ?? profilePath())
  const target = resolve(settings.pendingDataPath)
  validTarget(source, target)
  migrate(source, target)
  writeSettings({ version: SETTINGS_VERSION, dataPath: target })
}

export function heavyDataRoot(): string {
  // Empty values count as unset at each step.
  const override = process.env.IBLIS_DATA_DIR
  if (override) return resolve(override)
  const stored = readSettings().dataPath
  if (stored) return resolve(stored)
  return resolve(profilePath())
}

export function storageLocation(): StorageLocation {
  const settings = readSettings()
  return {
    dataPath: heavyDataRoot(),
    defaultPath: profilePath(),
    ...(settings.pendingDataPath ? { pendingDataPath: settings.pendingDataPath } : {})
  }
}

export async function chooseStorageLocation(owner: BrowserWindow | null): Promise<StorageLocation> {
  const picked = owner
    ? await dialog.showOpenDialog(owner, {
        title: 'Choose the folder for Iblis data',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory']
      })
    : await dialog.showOpenDialog({
        title: 'Choose the folder for Iblis data',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory']
      })
  if (picked.canceled || picked.filePaths.length !== 1 || !picked.filePaths[0])
    return storageLocation()
  const target = resolve(picked.filePaths[0])
  const source = heavyDataRoot()
  validTarget(source, target)
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error('Choose an empty folder for Iblis data.')
  }
  writeSettings({
    version: SETTINGS_VERSION,
    dataPath: readSettings().dataPath,
    pendingDataPath: target
  })
  return storageLocation()
}
