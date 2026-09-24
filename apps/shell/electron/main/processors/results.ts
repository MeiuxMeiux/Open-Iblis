// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ProcessorJobStateV1 } from '@iblis/plugin-sdk'
import type { ProcessorResultRecord } from '../../../shared/processors'
import { processorFailure } from './errors'
import type { ProcessorJob } from './store'

export type DoneState = Extract<ProcessorJobStateV1, { status: 'done' }>
type ResultProvenance = Omit<ProcessorResultRecord, 'trackId' | 'capability' | 'value'>

// One stored record per requested capability; a sidecar that omits any of
// them fails the whole job rather than persisting a partial answer.
export function resultRecords(
  job: ProcessorJob,
  done: DoneState,
  provenance: ResultProvenance
): ProcessorResultRecord[] {
  const byCapability = new Map(done.results.map((result) => [result.capability, result]))
  if (job.capabilities.some((capability) => !byCapability.has(capability))) {
    throw processorFailure({
      code: 'incomplete_result',
      message: 'processor omitted a requested result',
      retryable: false
    })
  }
  return job.capabilities.map((capability) => {
    const result = byCapability.get(capability)
    // Unreachable: completeness was checked above.
    if (!result) throw new Error(`processor result for ${capability} is missing`)
    const base = { trackId: job.trackId, ...provenance }
    if (result.capability === 'bpm-detect') {
      return { ...base, capability: 'bpm-detect', value: result.value }
    }
    return { ...base, capability: 'key-detect', value: result.value }
  })
}
