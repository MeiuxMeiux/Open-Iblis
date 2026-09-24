// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Minimal ambient typings for the untyped vendor detector libraries. Only the
// surface the built-in providers call is declared; anything else stays unknown.

declare module 'music-tempo' {
  class MusicTempo {
    constructor(data: Float32Array | number[], params?: Record<string, unknown>)
    tempo: string
    beats: number[]
  }
  export default MusicTempo
}

declare module 'essentia.js' {
  export interface EssentiaVector {
    delete(): void
  }
  export class Essentia {
    constructor(wasm: unknown)
    arrayToVector(data: Float32Array): EssentiaVector
    PercivalBpmEstimator(
      signal: EssentiaVector,
      frameSize: number,
      frameSizeOSS: number,
      hopSize: number,
      hopSizeOSS: number,
      maxBPM: number,
      minBPM: number,
      sampleRate: number
    ): { bpm: number }
    KeyExtractor(
      audio: EssentiaVector,
      averageDetuningCorrection: boolean,
      frameSize: number,
      hopSize: number,
      hpcpSize: number,
      maxFrequency: number,
      minFrequency: number,
      maximumSpectralPeaks: number,
      pcpThreshold: number,
      profileType: string,
      sampleRate: number,
      spectralPeaksThreshold: number,
      tuningFrequency: number,
      weightType: string,
      windowType: string
    ): { key: string; scale: string; strength: number }
  }
  export const EssentiaWASM: unknown
}
