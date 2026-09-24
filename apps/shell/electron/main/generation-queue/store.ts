// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  QueueDocument,
  QueueEntry,
  QueueEntryStatus,
  QueueTarget
} from '../../../shared/generation-queue'
import type { QueueRecipeRules } from '../engine/provider'
import { MAX_UNREVEALED_COMPARISONS } from './comparison'
import { ignoreFailure } from '../ignore-failure'

// 32 bounded pending requests plus 64 bounded terminal snapshots fit below
// this ceiling even when prompts/lyrics approach their accepted limits.
const MAX_QUEUE_BYTES = 8 * 1024 * 1024
const STATUSES = new Set<QueueEntryStatus>([
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
  'interrupted'
])

export interface QueueStore {
  load(): Promise<{ document: QueueDocument; corrupt: boolean; migrated?: boolean }>
  replace(document: QueueDocument): Promise<void>
}

function empty(): QueueDocument {
  return { version: 2, paused: false, entries: [] }
}

// The queue file is untrusted until valid() accepts it, so the fields the
// validators probe are typed as they may actually arrive from disk.
type UncheckedTarget = Omit<QueueTarget, 'protocol'> & { protocol: unknown }
type UncheckedEntry = Omit<QueueEntry, 'request' | 'target'> & {
  request: QueueEntry['request'] | null | undefined
  target?: UncheckedTarget | null
}
interface UncheckedDocument {
  version: unknown
  paused: boolean
  pauseReason?: string
  entries: (UncheckedEntry | null | undefined)[]
}
type LegacyDocument = Omit<QueueDocument, 'version' | 'entries'> & {
  version: 1
  entries: (QueueEntry | null | undefined)[]
}

function migrate(
  value: unknown,
  rules: QueueRecipeRules
): { document: unknown; migrated: boolean } {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) {
    return { document: value, migrated: false }
  }
  const legacy = value as LegacyDocument
  if (!Array.isArray(legacy.entries)) throw new Error('invalid legacy queue document')
  let reviewRequired = false
  const entries: (UncheckedEntry | null | undefined)[] = []
  for (const entry of legacy.entries) {
    if (
      entry &&
      ['pending', 'running'].includes(entry.status) &&
      rules.canonicalRequestError(entry.request) !== null
    ) {
      reviewRequired = true
      const at = Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now()
      entries.push({
        ...entry,
        status: 'interrupted' as const,
        updatedAt: at,
        finishedAt: at,
        error: {
          code: 'legacy_queue_recipe',
          message: 'This queued take predates reproducible runtime profiles and was not started.'
        }
      })
      continue
    }
    entries.push(entry)
  }
  const document: UncheckedDocument = {
    ...legacy,
    version: 2,
    paused: reviewRequired || legacy.paused,
    ...(reviewRequired
      ? { pauseReason: 'Earlier queued takes need review after the profile upgrade.' }
      : {}),
    entries
  }
  return { migrated: true, document }
}

function validTarget(value: UncheckedTarget | null | undefined): boolean {
  if (value === undefined) return true
  return (
    !!value &&
    typeof value.pluginId === 'string' &&
    value.pluginId.length > 0 &&
    value.pluginId.length <= 128 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    value.version.length <= 64 &&
    (value.protocol === 1 || value.protocol === 2) &&
    (value.descriptorHash === undefined || /^[0-9a-f]{64}$/.test(value.descriptorHash))
  )
}

function valid(parsed: unknown, rules: QueueRecipeRules): parsed is QueueDocument {
  const value = parsed as UncheckedDocument | null | undefined
  if (!(
    !!value &&
    value.version === 2 &&
    typeof value.paused === 'boolean' &&
    (value.pauseReason === undefined || typeof value.pauseReason === 'string') &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        !!entry &&
        typeof entry.id === 'string' &&
        STATUSES.has(entry.status) &&
        !!entry.request &&
        typeof entry.request.prompt === 'string' &&
        typeof entry.request.preset === 'string' &&
        typeof entry.request.durationSec === 'number' &&
        Number.isFinite(entry.request.durationSec) &&
        (!['pending', 'running'].includes(entry.status) ||
          rules.canonicalRequestError(entry.request) === null) &&
        validTarget(entry.target) &&
        (entry.comparison === undefined ||
          (typeof entry.comparison.groupId === 'string' &&
            entry.comparison.groupId.length > 0 &&
            entry.comparison.groupId.length <= 128 &&
            ['A', 'B'].includes(entry.comparison.blindLabel) &&
            typeof entry.comparison.revealed === 'boolean' &&
            (entry.comparison.internalBlueprint === undefined ||
              rules.validBlueprint(entry.comparison.internalBlueprint)))) &&
        Number.isFinite(entry.createdAt) &&
        Number.isFinite(entry.updatedAt)
    )
  )) {
    return false
  }
  // The every() above proved each entry's shape.
  const checked = value.entries as QueueEntry[]
  const ids = checked.map((entry) => entry.id)
  const comparisons = new Map<string, QueueEntry[]>()
  for (const entry of checked) {
    if (!entry.comparison) continue
    const group = comparisons.get(entry.comparison.groupId) ?? []
    group.push(entry)
    comparisons.set(entry.comparison.groupId, group)
  }
  return (
    new Set(ids).size === ids.length &&
    checked.filter((entry) => entry.status === 'pending').length <= 32 &&
    [...comparisons.values()].filter((group) => !group[0]?.comparison?.revealed).length <=
      MAX_UNREVEALED_COMPARISONS &&
    [...comparisons.values()].every((group) => {
      const controls = group.filter((entry) => rules.isComparisonControl(entry.request))
      const control = controls[0]
      const candidate = group.find((entry) => entry !== control)
      return (
        group.length === 2 &&
        controls.length === 1 &&
        !!control &&
        !!candidate &&
        rules.comparisonRecipeError(control.request, candidate.request) === null &&
        group.filter((entry) => entry.comparison?.internalBlueprint !== undefined).length <= 1 &&
        new Set(group.map((entry) => entry.comparison?.blindLabel)).size === 2 &&
        new Set(group.map((entry) => entry.comparison?.revealed)).size === 1
      )
    })
  )
}

export function createGenerationQueueStore(file: string, rules: QueueRecipeRules): QueueStore {
  return {
    async load(): Promise<{ document: QueueDocument; corrupt: boolean; migrated?: boolean }> {
      let handle: Awaited<ReturnType<typeof open>> | undefined
      try {
        handle = await open(file, 'r')
        const size = (await handle.stat()).size
        if (size > MAX_QUEUE_BYTES) throw new Error('queue document exceeds size cap')
        const bytes = Buffer.alloc(size)
        const result = await handle.read(bytes, 0, size, 0)
        if (result.bytesRead !== size) throw new Error('queue document changed while reading')
        const migrated = migrate(JSON.parse(bytes.toString('utf8')), rules)
        if (!valid(migrated.document, rules)) throw new Error('invalid queue document')
        return { document: migrated.document, migrated: migrated.migrated, corrupt: false }
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null | undefined)?.code === 'ENOENT') {
          return { document: empty(), corrupt: false }
        }
        await handle?.close().catch(ignoreFailure)
        handle = undefined
        await rename(file, `${file}.corrupt`).catch(ignoreFailure)
        return { document: empty(), corrupt: true }
      } finally {
        await handle?.close().catch(ignoreFailure)
      }
    },

    async replace(document: QueueDocument): Promise<void> {
      const text = JSON.stringify(document, null, 1)
      if (Buffer.byteLength(text, 'utf8') > MAX_QUEUE_BYTES) {
        throw new Error('queue document exceeds size cap')
      }
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(tmp, text, 'utf8')
        await rename(tmp, file)
      } catch (error) {
        await rm(tmp, { force: true }).catch(ignoreFailure)
        throw error
      }
    }
  }
}
