// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Per-operation default engine selection (engine contract v2, registry
// slice). Deterministic and tiny: a JSON file mapping operation ids to the
// plugin id the user last chose. The registry falls back to the first
// installed engine when the stored default is absent or uninstalled —
// "first installed" as a policy is gone.

import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ENGINE_V2_OPERATION_IDS } from '@iblis/plugin-sdk'

const MAX_BYTES = 16 * 1024
const PLUGIN_ID = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/

interface DefaultsDocument {
  version: 1
  operations: Record<string, string>
}

let cache: DefaultsDocument | null = null

function file(): string {
  return join(app.getPath('userData'), 'engine-defaults.json')
}

function valid(value: unknown): value is DefaultsDocument {
  if (!value || typeof value !== 'object') return false
  const doc = value as { version?: unknown; operations?: unknown }
  if (doc.version !== 1 || !doc.operations || typeof doc.operations !== 'object') return false
  return Object.entries(doc.operations).every(
    ([operation, pluginId]) =>
      (ENGINE_V2_OPERATION_IDS as readonly string[]).includes(operation) &&
      typeof pluginId === 'string' &&
      PLUGIN_ID.test(pluginId)
  )
}

function load(): DefaultsDocument {
  if (cache) return cache
  try {
    const bytes = readFileSync(file())
    if (bytes.byteLength > MAX_BYTES) throw new Error('oversized')
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    cache = valid(parsed) ? parsed : { version: 1, operations: {} }
  } catch {
    cache = { version: 1, operations: {} }
  }
  return cache
}

export function defaultEngineFor(operation: string): string | null {
  return load().operations[operation] ?? null
}

export function setDefaultEngine(operation: string, pluginId: string | null): void {
  if (!(ENGINE_V2_OPERATION_IDS as readonly string[]).includes(operation)) {
    throw new Error(`unknown operation ${operation}`)
  }
  if (pluginId !== null && !PLUGIN_ID.test(pluginId)) {
    throw new Error('engine id is not a plugin id')
  }
  const doc = load()
  if (pluginId === null) delete doc.operations[operation]
  else doc.operations[operation] = pluginId
  const path = file()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${crypto.randomUUID()}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(doc, null, 1), 'utf8')
    renameSync(tmp, path)
  } catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
}

// Test seam: forget the in-memory copy so a fresh userData dir reloads.
export function resetEngineDefaultsCache(): void {
  cache = null
}
