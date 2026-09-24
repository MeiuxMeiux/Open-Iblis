// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Measured audio/media facts shared between main and renderer. Split from
// contract.ts (which re-exports these) to keep that file within the LOC cap.

// Exact facts parsed from one validated RIFF/WAVE container. Frame count and
// sample rate are the duration authority; durationSec is their convenient
// quotient for UI and browser comparison.
export interface WavFacts {
  containerBytes: number
  formatTag: number
  codecTag: 1 | 3
  codec: 'pcm' | 'ieee-float'
  sampleRateHz: number
  channels: number
  bitsPerSample: number
  validBitsPerSample?: number
  channelMask?: number
  blockAlignBytes: number
  byteRateBytesPerSec: number
  dataOffset: number
  dataBytes: number
  frames: number
  durationSec: number
}

export interface MediaObservation {
  durationSec: number
  seekable: boolean
  seekableStartSec?: number
  seekableEndSec?: number
}

export interface PeakEnvelope {
  frames: number
  sampleRateHz: number
  durationSec: number
  min: number[]
  max: number[]
}

export interface AudibleBounds {
  classification: 'audible' | 'silent' | 'indeterminate'
  algorithm: 'sustained-channel-rms-v1'
  openDbfs: number
  closeDbfs: number
  windowFrames: number
  openWindows: number
  closeWindows: number
  attackPadMs: number
  reverbPadMs: number
  detectedStartFrame?: number
  detectedEndFrameExclusive?: number
  startFrame?: number
  endFrameExclusive?: number
  leadingSilenceSec: number
  trailingSilenceSec: number
  audibleDurationSec?: number
}

// Versioned, validated analysis persisted beside an immutable audio.wav.
// Peaks are viewport-independent min/max buckets; the renderer aggregates
// them but never receives raw audio or invents amplitude data.
export interface AudioAnalysis {
  version: 1
  source: WavFacts
  peaks: PeakEnvelope
  peakAmplitude: number
  rmsAmplitude: number
  clippedSamples: number
  audible: AudibleBounds
}
