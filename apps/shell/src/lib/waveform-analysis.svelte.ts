// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AudioAnalysis, IblisApi, IpcResult } from '../../shared/contract'

export type WaveformAnalysisState =
  | { phase: 'idle' }
  | { phase: 'loading'; trackId: string }
  | { phase: 'ready'; trackId: string; analysis: AudioAnalysis }
  | { phase: 'error'; trackId: string; error: string }

type AnalysisLoader = (id: string) => Promise<IpcResult<AudioAnalysis>>

export interface WaveformAnalysisStore {
  readonly state: WaveformAnalysisState
  select(id: string | null): Promise<void>
}

const CACHE_LIMIT = 8

export function createWaveformAnalysisStore(load: AnalysisLoader): WaveformAnalysisStore {
  let state = $state<WaveformAnalysisState>({ phase: 'idle' })
  let epoch = 0
  const cache = new Map<string, AudioAnalysis>()

  function remember(id: string, analysis: AudioAnalysis): void {
    cache.delete(id)
    cache.set(id, analysis)
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next()
      if (oldest.done) break
      cache.delete(oldest.value)
    }
  }

  return {
    get state() {
      return state
    },

    async select(id) {
      if (!id) {
        if (state.phase === 'idle') return
        epoch++
        state = { phase: 'idle' }
        return
      }
      if ((state.phase === 'loading' || state.phase === 'ready') && state.trackId === id) {
        return
      }

      const current = ++epoch
      const cached = cache.get(id)
      if (cached) {
        remember(id, cached)
        state = { phase: 'ready', trackId: id, analysis: cached }
        return
      }

      state = { phase: 'loading', trackId: id }
      try {
        const result = await load(id)
        if (current !== epoch) return
        if (!result.ok) {
          state = { phase: 'error', trackId: id, error: result.error }
          return
        }
        remember(id, result.data)
        state = { phase: 'ready', trackId: id, analysis: result.data }
      } catch (error) {
        if (current !== epoch) return
        const message = (error as { message?: unknown } | null | undefined)?.message
        state = { phase: 'error', trackId: id, error: String(message ?? error) }
      }
    }
  }
}

export const waveformAnalysis = createWaveformAnalysisStore((id) => {
  const renderer = globalThis as unknown as { window: { iblis: IblisApi } }
  return renderer.window.iblis.library.analysis(id)
})
