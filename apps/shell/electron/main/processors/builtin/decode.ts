// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// WAV -> mono Float32Array at the fixed analysis rate for the built-in
// detectors. Every detector sees identical input, so their BPM/key opinions
// are comparable. Reuses the strict RIFF parser; decoding stays in the worker
// thread so a long track never blocks main.

import { readFile } from 'node:fs/promises'
import { parseWav, type WavMetadata } from '../../media/wav'

export const ANALYSIS_SAMPLE_RATE = 44100
const MAX_DECODE_BYTES = 512 * 1024 * 1024
// Detectors converge long before this; trimming bounds worker memory and time.
const MAX_ANALYSIS_SECONDS = 480

export interface DecodedAudio {
  samples: Float32Array
  sampleRate: typeof ANALYSIS_SAMPLE_RATE
  sourceDurationSec: number
}

function frameValue(view: DataView, byteOffset: number, facts: WavMetadata): number {
  if (facts.codec === 'ieee-float') {
    return facts.bitsPerSample === 32
      ? view.getFloat32(byteOffset, true)
      : view.getFloat64(byteOffset, true)
  }
  switch (facts.bitsPerSample) {
    case 8:
      return (view.getUint8(byteOffset) - 128) / 128
    case 16:
      return view.getInt16(byteOffset, true) / 32768
    case 24: {
      const raw =
        view.getUint8(byteOffset) |
        (view.getUint8(byteOffset + 1) << 8) |
        (view.getUint8(byteOffset + 2) << 16)
      return (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608
    }
    default:
      return view.getInt32(byteOffset, true) / 2147483648
  }
}

export function decodeWavMonoBytes(bytes: Uint8Array): DecodedAudio {
  const facts = parseWav(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bytesPerSample = facts.bitsPerSample / 8
  const frames = Math.min(facts.frames, facts.sampleRateHz * MAX_ANALYSIS_SECONDS)
  const mono = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    const base = facts.dataOffset + frame * facts.blockAlignBytes
    let sum = 0
    for (let channel = 0; channel < facts.channels; channel++) {
      sum += frameValue(view, base + channel * bytesPerSample, facts)
    }
    const value = sum / facts.channels
    if (!Number.isFinite(value)) throw new Error('audio contains non-finite samples')
    mono[frame] = value
  }
  return {
    samples: resampleLinear(mono, facts.sampleRateHz, ANALYSIS_SAMPLE_RATE),
    sampleRate: ANALYSIS_SAMPLE_RATE,
    sourceDurationSec: facts.durationSec
  }
}

export async function decodeWavMono(path: string): Promise<DecodedAudio> {
  const bytes = await readFile(path)
  if (bytes.length > MAX_DECODE_BYTES) throw new Error('audio exceeds the analysis size limit')
  return decodeWavMonoBytes(bytes)
}

// Linear interpolation is ample for tempo/key features; detectors never see
// audio destined for playback.
function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const outLength = Math.max(1, Math.floor((input.length * to) / from))
  const output = new Float32Array(outLength)
  const step = from / to
  for (let i = 0; i < outLength; i++) {
    const position = i * step
    const index = Math.floor(position)
    const fraction = position - index
    const a = input[index] ?? 0
    const b = input[index + 1] ?? a
    output[i] = a + (b - a) * fraction
  }
  return output
}
