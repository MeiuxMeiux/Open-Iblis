// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
import type { IpcResult } from './contract'
import type {
  ProcessorProviderDetail,
  ProcessorBenchmarkView,
  ProcessorResultRecord,
  ProcessorSettings
} from './processors'

// The renderer's deliberately narrow processor bridge. Provider detail is
// disclosure metadata, never a full manifest or a private-lab catalog entry.
export interface ProcessorsApi {
  processors: {
    settings: () => Promise<IpcResult<ProcessorSettings>>
    detail: (id: string) => Promise<IpcResult<ProcessorProviderDetail | null>>
    acknowledge: (id: string) => Promise<IpcResult<ProcessorSettings>>
    setDefault: (
      capability: ProcessorAnalysisCapability,
      pluginId?: string
    ) => Promise<IpcResult<ProcessorSettings>>
    results: (trackId: string) => Promise<IpcResult<ProcessorResultRecord[]>>
    benchmarks: () => Promise<IpcResult<ProcessorBenchmarkView[]>>
    benchmark: (
      trackId: string,
      providerIds: string[]
    ) => Promise<IpcResult<ProcessorBenchmarkView>>
    exportBenchmark: (id: string) => Promise<IpcResult<boolean>>
    retry: (trackId: string, capability: ProcessorAnalysisCapability) => Promise<IpcResult<null>>
  }
}
