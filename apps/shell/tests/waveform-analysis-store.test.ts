// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest'
import type { AudioAnalysis, IpcResult } from '../shared/contract'
import { createWaveformAnalysisStore } from '../src/lib/waveform-analysis.svelte'

function analysis(frames: number): AudioAnalysis {
  return {
    version: 1,
    source: {
      containerBytes: 48,
      formatTag: 3,
      codecTag: 3,
      codec: 'ieee-float',
      sampleRateHz: 1000,
      channels: 1,
      bitsPerSample: 32,
      blockAlignBytes: 4,
      byteRateBytesPerSec: 4000,
      dataOffset: 44,
      dataBytes: frames * 4,
      frames,
      durationSec: frames / 1000
    },
    peaks: {
      frames,
      sampleRateHz: 1000,
      durationSec: frames / 1000,
      min: [-0.5],
      max: [0.5]
    },
    peakAmplitude: 0.5,
    rmsAmplitude: 0.25,
    clippedSamples: 0,
    audible: {
      classification: 'indeterminate',
      algorithm: 'sustained-channel-rms-v1',
      openDbfs: -45,
      closeDbfs: -51,
      windowFrames: 10,
      openWindows: 5,
      closeWindows: 15,
      attackPadMs: 50,
      reverbPadMs: 500,
      startFrame: 0,
      endFrameExclusive: frames,
      leadingSilenceSec: 0,
      trailingSilenceSec: 0,
      audibleDurationSec: frames / 1000
    }
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

describe('waveform analysis renderer store', () => {
  it('rejects stale track results', async () => {
    const a = deferred<IpcResult<AudioAnalysis>>()
    const b = deferred<IpcResult<AudioAnalysis>>()
    const store = createWaveformAnalysisStore((id) => (id === 'a' ? a.promise : b.promise))

    const first = store.select('a')
    const second = store.select('b')
    a.resolve({ ok: true, data: analysis(100) })
    await first
    expect(store.state).toEqual({ phase: 'loading', trackId: 'b' })
    b.resolve({ ok: true, data: analysis(200) })
    await second
    expect(store.state).toMatchObject({ phase: 'ready', trackId: 'b' })
  })

  it('caches ready results and keeps failures nonfatal', async () => {
    const load = vi.fn(async (id: string): Promise<IpcResult<AudioAnalysis>> =>
      id === 'bad' ? { ok: false, error: 'unsupported' } : { ok: true, data: analysis(100) }
    )
    const store = createWaveformAnalysisStore(load)
    await store.select('a')
    await store.select(null)
    await store.select('a')
    expect(load).toHaveBeenCalledTimes(1)
    expect(store.state.phase).toBe('ready')

    await store.select('bad')
    expect(store.state).toEqual({ phase: 'error', trackId: 'bad', error: 'unsupported' })
  })

  it('does not restart a same-track load or flicker a ready result', async () => {
    const pending = deferred<IpcResult<AudioAnalysis>>()
    const load = vi.fn(async () => pending.promise)
    const store = createWaveformAnalysisStore(load)

    const first = store.select('a')
    await store.select('a')
    expect(load).toHaveBeenCalledTimes(1)
    expect(store.state).toEqual({ phase: 'loading', trackId: 'a' })

    pending.resolve({ ok: true, data: analysis(100) })
    await first
    await store.select('a')
    expect(load).toHaveBeenCalledTimes(1)
    expect(store.state).toMatchObject({ phase: 'ready', trackId: 'a' })
  })
})
