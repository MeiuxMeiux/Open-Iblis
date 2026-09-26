// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { makeWav } from './wav'

// Stereo IEEE-float WAV of `seconds` built from a per-sample function, the
// format the stem sidecar writes.
export function stereoFloatWav(
  seconds: number,
  sample: (t: number) => number,
  sampleRateHz = 8000
): Buffer {
  const frames = Math.round(seconds * sampleRateHz)
  const data = Buffer.alloc(frames * 2 * 4)
  for (let i = 0; i < frames; i++) {
    const v = sample(i / sampleRateHz)
    data.writeFloatLE(v, i * 8)
    data.writeFloatLE(v, i * 8 + 4)
  }
  return makeWav({ codec: 'ieee-float', bitsPerSample: 32, sampleRateHz, channels: 2, data })
}

// A kick-like click train at `bpm`.
export function clickTrack(bpm: number): (t: number) => number {
  const period = 60 / bpm
  return (t) => {
    const phase = t % period
    return phase < 0.02 ? Math.sin(2 * Math.PI * 80 * phase) * (1 - phase / 0.02) * 0.9 : 0
  }
}

export function tone(hz: number, amp = 0.3): (t: number) => number {
  return (t) => Math.sin(2 * Math.PI * hz * t) * amp
}
