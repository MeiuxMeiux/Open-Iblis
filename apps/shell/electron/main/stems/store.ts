// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Persisted stem settings and job state (userData/stem-jobs.json). Promoted
// stem sets live beside the track they belong to, so this file never holds
// artifacts: losing it loses queue history, never stems.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { STEM_BACKENDS, type StemBackend } from '@iblis/plugin-sdk'
import type { StemJobView, StemSettings } from '../../../shared/stems'

export interface StemJob extends StemJobView {
  providerVersion: string
  sourceSha256: string
}

interface Document {
  version: 1
  settings: StemSettings
  jobs: StemJob[]
}

export interface StemStore {
  load(): Promise<void>
  settings(): StemSettings
  setSettings(patch: Partial<StemSettings>): Promise<StemSettings>
  jobs(): StemJob[]
  job(trackId: string): StemJob | undefined
  saveJob(job: StemJob): Promise<void>
  removeTrack(trackId: string): Promise<void>
  settled(): Promise<void>
}

const MAX_JOBS = 200
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function isBackend(value: unknown): value is StemBackend {
  return typeof value === 'string' && (STEM_BACKENDS as readonly string[]).includes(value)
}

function settingsOf(value: unknown): StemSettings {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  return {
    backend: isBackend(input.backend) ? input.backend : 'auto',
    ...(typeof input.defaultProvider === 'string' && input.defaultProvider
      ? { defaultProvider: input.defaultProvider }
      : {})
  }
}

export function createStemStore(file: string): StemStore {
  let data: Document = { version: 1, settings: { backend: 'auto' }, jobs: [] }
  let loaded = false
  let writes = Promise.resolve()

  function persist(): Promise<void> {
    const snapshot = JSON.stringify(data, null, 2)
    writes = writes
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        const temp = `${file}.tmp`
        await writeFile(temp, snapshot, 'utf8')
        await rename(temp, file)
      })
      .catch(() => undefined)
    return writes
  }

  return {
    async load() {
      if (loaded) return
      loaded = true
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<Document> | null
        if (parsed?.version !== 1 || !Array.isArray(parsed.jobs)) throw new Error('invalid')
        data = {
          version: 1,
          settings: settingsOf(parsed.settings),
          jobs: parsed.jobs.slice(-MAX_JOBS)
        }
      } catch {
        // Missing or unreadable: start empty. Stem sets on disk are unaffected.
      }
    },
    settings: () => clone(data.settings),
    async setSettings(patch) {
      const next = settingsOf({ ...data.settings, ...patch })
      if ('defaultProvider' in patch && !patch.defaultProvider) delete next.defaultProvider
      data = { ...data, settings: next }
      await persist()
      return clone(next)
    },
    jobs: () => clone(data.jobs),
    job: (trackId) => {
      const found = [...data.jobs].reverse().find((job) => job.trackId === trackId)
      return found ? clone(found) : undefined
    },
    async saveJob(job) {
      const rest = data.jobs.filter((candidate) => candidate.id !== job.id)
      data = { ...data, jobs: [...rest, clone(job)].slice(-MAX_JOBS) }
      await persist()
    },
    async removeTrack(trackId) {
      data = { ...data, jobs: data.jobs.filter((job) => job.trackId !== trackId) }
      await persist()
    },
    settled: () => writes
  }
}
