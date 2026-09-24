// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
import type { ProcessorConfig } from './config'
import type {
  ProcessorAcknowledgement,
  ProcessorBenchmarkRun,
  ProcessorJobView,
  ProcessorResultRecord,
  ProcessorSettings
} from '../../../shared/processors'
import { ignoreFailure } from '../ignore-failure'

export interface ProcessorJob extends ProcessorJobView {
  sourceSha256: string
  config: ProcessorConfig
  configHash: string
}

interface Document {
  version: 2
  settings: ProcessorSettings
  jobs: ProcessorJob[]
  results: ProcessorResultRecord[]
  benchmarks: ProcessorBenchmarkRun[]
}

// The on-disk shape before validation: version 1 files lack benchmarks, and a
// hand-edited or truncated file may lack settings or not be an object at all.
type StoredDocument = Omit<Document, 'version' | 'settings' | 'benchmarks'> & {
  version: unknown
  settings?: Partial<ProcessorSettings> | null
  benchmarks?: ProcessorBenchmarkRun[]
}

export interface ProcessorStore {
  load(): Promise<void>
  settings(): ProcessorSettings
  setDefault(capability: ProcessorAnalysisCapability, pluginId?: string): Promise<ProcessorSettings>
  acknowledge(id: string, acknowledgement: ProcessorAcknowledgement): Promise<ProcessorSettings>
  jobs(): ProcessorJob[]
  results(trackId: string): ProcessorResultRecord[]
  allResults(): ProcessorResultRecord[]
  benchmarks(): ProcessorBenchmarkRun[]
  saveBenchmark(benchmark: ProcessorBenchmarkRun): Promise<void>
  saveJob(job: ProcessorJob): Promise<void>
  saveResults(results: ProcessorResultRecord[]): Promise<void>
  removeTrack(trackId: string): Promise<void>
  // Resolves once every queued write has reached disk.
  settled(): Promise<void>
}

const empty = (): Document => ({
  version: 2,
  settings: { defaults: {}, providers: [], acknowledgements: {} },
  jobs: [],
  results: [],
  benchmarks: []
})
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function createProcessorStore(file: string): ProcessorStore {
  let data: Document | null = null
  let writes = Promise.resolve()

  async function load(): Promise<void> {
    if (data) return
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as StoredDocument | null
      if (
        (parsed?.version !== 1 && parsed?.version !== 2) ||
        !Array.isArray(parsed.jobs) ||
        !Array.isArray(parsed.results)
      ) {
        throw new Error('invalid processor document')
      }
      data = {
        ...parsed,
        version: 2,
        settings: {
          defaults: parsed.settings?.defaults ?? {},
          providers: [],
          acknowledgements: parsed.settings?.acknowledgements ?? {}
        },
        benchmarks:
          'benchmarks' in parsed && Array.isArray(parsed.benchmarks) ? parsed.benchmarks : []
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null | undefined)?.code !== 'ENOENT') {
        await rename(file, `${file}.corrupt`).catch(ignoreFailure)
      }
      data = empty()
    }
  }

  function document(): Document {
    if (!data) throw new Error('processor store was not loaded')
    return data
  }

  // Writes run one at a time. A failed write rejects only its own caller, so
  // the next save still runs (and carries the full document).
  function persist(): Promise<void> {
    const next = writes.catch(ignoreFailure).then(async () => {
      const serialized = JSON.stringify(document(), null, 1)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(`${file}.tmp`, serialized, 'utf8')
      await rename(`${file}.tmp`, file)
    })
    writes = next
    return next
  }

  return {
    load,
    settled: () => writes.catch(ignoreFailure),
    settings: () => clone(document().settings),
    async setDefault(capability, pluginId) {
      if (pluginId) document().settings.defaults[capability] = pluginId
      else delete document().settings.defaults[capability]
      await persist()
      return clone(document().settings)
    },
    async acknowledge(id, acknowledgement) {
      document().settings.acknowledgements[id] = acknowledgement
      await persist()
      return clone(document().settings)
    },
    jobs: () => clone(document().jobs),
    results: (trackId) => clone(document().results.filter((result) => result.trackId === trackId)),
    allResults: () => clone(document().results),
    benchmarks: () => clone(document().benchmarks),
    async saveBenchmark(benchmark) {
      const benchmarks = document().benchmarks
      const index = benchmarks.findIndex((candidate) => candidate.id === benchmark.id)
      if (index < 0) benchmarks.push(clone(benchmark))
      else benchmarks[index] = clone(benchmark)
      await persist()
    },
    async saveJob(job) {
      const jobs = document().jobs
      const index = jobs.findIndex((candidate) => candidate.id === job.id)
      if (index < 0) jobs.push(clone(job))
      else jobs[index] = clone(job)
      if (job.benchmarkId) {
        const benchmark = document().benchmarks.find(
          (candidate) => candidate.id === job.benchmarkId
        )
        if (benchmark) benchmark.updatedAt = job.updatedAt
      }
      await persist()
    },
    async saveResults(results) {
      const d = document()
      for (const result of results) {
        d.results = d.results.filter(
          (candidate) =>
            !(
              candidate.trackId === result.trackId &&
              candidate.capability === result.capability &&
              candidate.pluginId === result.pluginId &&
              candidate.pluginVersion === result.pluginVersion &&
              candidate.sourceSha256 === result.sourceSha256 &&
              candidate.configHash === result.configHash
            )
        )
        d.results.push(clone(result))
      }
      await persist()
    },
    async removeTrack(trackId) {
      const d = document()
      d.jobs = d.jobs.filter((job) => job.trackId !== trackId)
      d.results = d.results.filter((result) => result.trackId !== trackId)
      await persist()
    }
  }
}
