// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
import type {
  ProcessorJobView,
  ProcessorProviderView,
  ProcessorResultRecord,
  ProcessorSettings
} from '../../../shared/processors'

export function capabilityName(capability: ProcessorAnalysisCapability): string {
  return capability === 'bpm-detect' ? 'BPM' : 'Key'
}

export function needsAcknowledgement(provider: ProcessorProviderView): boolean {
  return provider.requiresAcknowledgement
}

export function legalStatus(status: ProcessorProviderView['legalStatus']): string {
  if (status === 'commercial-candidate') return 'Commercial candidate'
  if (status === 'evaluation-only') return 'Evaluation only'
  if (status === 'licence-required') return 'Terms required'
  if (status === 'blocked') return 'Blocked'
  return 'Disclosure missing'
}

export function detectedValue(result: ProcessorResultRecord): string {
  return result.capability === 'bpm-detect'
    ? `${result.value.bpm.toFixed(1)} BPM`
    : `${result.value.pitchClass} ${result.value.mode}`
}

export function jobStatus(job: ProcessorJobView): string {
  if (job.status === 'queued') return 'Queued'
  if (job.status === 'running')
    return `Running${job.progress ? ` (${Math.round(job.progress * 100)}%)` : ''}`
  if (job.status === 'done') return 'Completed'
  if (job.status === 'cancelled') return 'Cancelled'
  return 'Failed'
}

export function providerState(
  settings: ProcessorSettings,
  capability: ProcessorAnalysisCapability
): string {
  const selected = settings.defaults[capability]
  if (
    !selected &&
    !settings.providers.some((provider) => provider.capabilities.includes(capability))
  ) {
    return `No approved ${capabilityName(capability)} detector is installed. Detection is off.`
  }
  if (selected && !settings.providers.some((provider) => provider.id === selected)) {
    return `The selected provider (${selected}) is unavailable. Detection is off until it returns.`
  }
  if (!selected)
    return `Detection is off. Select an installed ${capabilityName(capability)} provider to enable it.`
  return `Using ${selected}. Results stay labeled with its version.`
}
