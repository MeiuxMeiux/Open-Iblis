// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ProcessorAnalysisCapability, ProcessorEvaluationV1 } from '@iblis/plugin-sdk'
import type { ProcessorAcknowledgement } from '../../../shared/processors'

export interface ProcessorSelectionProvider {
  id: string
  version: string
  capabilities: ProcessorAnalysisCapability[]
  evaluation?: ProcessorEvaluationV1
}

export function assertProcessorDefault(
  provider: ProcessorSelectionProvider | null,
  capability: ProcessorAnalysisCapability,
  acknowledgement: ProcessorAcknowledgement | undefined
): void {
  if (!provider?.capabilities.includes(capability)) {
    throw new Error('selected processor is unavailable for this capability')
  }
  const evaluation = provider.evaluation
  const restricted =
    evaluation &&
    (evaluation.status !== 'commercial-candidate' || evaluation.distribution !== 'public-catalog')
  if (
    restricted &&
    (acknowledgement?.version !== provider.version ||
      acknowledgement.upstreamRevision !== evaluation.upstreamRevision)
  ) {
    throw new Error('processor acknowledgement is required before private evaluation')
  }
}

export function providerAcknowledgement(
  provider: ProcessorSelectionProvider,
  acknowledgedAt: number
): ProcessorAcknowledgement {
  if (!provider.evaluation) throw new Error('processor has no evaluation disclosure')
  return {
    version: provider.version,
    upstreamRevision: provider.evaluation.upstreamRevision,
    acknowledgedAt
  }
}
