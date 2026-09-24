// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Dispatch a built-in provider id + capability to its detector. Pure and
// worker-agnostic so tests can call it directly on synthetic audio.

import type { ProcessorAnalysisCapability, ProcessorAnalysisResultV1 } from '@iblis/plugin-sdk'
import { detectBpm, detectKey } from './dsp'
import { aubioBpm, essentiaBpm, essentiaKey, musicTempoBpm } from './vendors'

export async function runBuiltinDetector(
  providerId: string,
  capability: ProcessorAnalysisCapability,
  samples: Float32Array,
  sampleRate: number
): Promise<ProcessorAnalysisResultV1> {
  if (capability === 'bpm-detect') {
    switch (providerId) {
      case 'mx.iblis.builtin.dsp':
        return { capability, value: detectBpm(samples, sampleRate) }
      case 'mx.iblis.builtin.musictempo':
        return { capability, value: musicTempoBpm(samples) }
      case 'mx.iblis.builtin.essentia':
        return { capability, value: essentiaBpm(samples, sampleRate) }
      case 'mx.iblis.builtin.aubio':
        return { capability, value: await aubioBpm(samples, sampleRate) }
    }
  }
  if (capability === 'key-detect') {
    switch (providerId) {
      case 'mx.iblis.builtin.dsp':
        return { capability, value: detectKey(samples, sampleRate) }
      case 'mx.iblis.builtin.essentia':
        return { capability, value: essentiaKey(samples, sampleRate) }
    }
  }
  throw new Error(`built-in provider ${providerId} does not support ${capability}`)
}
