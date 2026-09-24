// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { analyzeWav } from '../electron/main/media/analysis'
import {
  decodeAnalysisSidecar,
  encodeAnalysisSidecar,
  type AnalysisSourceIdentity
} from '../electron/main/library/analysis/sidecar'
import type { AudibleBounds, WavFacts } from '../shared/media'
import { makeWav } from './fixtures/wav'

// The persisted sidecar as these tests edit it to forge bad input. The
// fixture is audible, so its audible duration is present.
interface ForgedSidecar {
  schema: number
  source: WavFacts
  envelope: { data: string; buckets: number; durationSec: number }
  audible: AudibleBounds & { audibleDurationSec: number }
  peakAmplitude: number
  rmsAmplitude: number
  clippedSamples: number
}

function parse(encoded: string): ForgedSidecar {
  return JSON.parse(encoded) as ForgedSidecar
}

function fixture(): {
  encoded: string
  identity: AnalysisSourceIdentity
  analysis: ReturnType<typeof analyzeWav>
} {
  const data = Buffer.alloc(400)
  for (let index = 0; index < 100; index++) data.writeFloatLE((index - 50) / 50, index * 4)
  const wav = makeWav({ codec: 'ieee-float', sampleRateHz: 1000, data })
  const analysis = analyzeWav(wav)
  const identity = { sha256: 'a'.repeat(64), size: wav.length, mtimeMs: 123.5 }
  return { encoded: encodeAnalysisSidecar(analysis, identity), identity, analysis }
}

function decode(
  encoded: string,
  analysis = fixture().analysis
): ReturnType<typeof decodeAnalysisSidecar> {
  const { identity } = fixture()
  return decodeAnalysisSidecar(encoded, {
    facts: analysis.source,
    size: identity.size,
    mtimeMs: identity.mtimeMs
  })
}

function decodeWithoutFacts(encoded: string): ReturnType<typeof decodeAnalysisSidecar> {
  const { identity } = fixture()
  return decodeAnalysisSidecar(encoded, {
    size: identity.size,
    mtimeMs: identity.mtimeMs
  })
}

describe('analysis sidecar', () => {
  it('round-trips validated Float32 envelope bits', () => {
    const { encoded, analysis } = fixture()
    const back = decode(encoded, analysis)
    expect(back).toEqual(analysis)
  })

  it('rejects schema, source identity, and source-fact mismatches', () => {
    const { encoded, identity, analysis } = fixture()
    const persisted = parse(encoded)
    persisted.schema = 2
    expect(decode(JSON.stringify(persisted), analysis)).toBeNull()

    expect(
      decodeAnalysisSidecar(encoded, {
        facts: analysis.source,
        size: identity.size,
        mtimeMs: identity.mtimeMs + 1
      })
    ).toBeNull()
    expect(
      decodeAnalysisSidecar(encoded, {
        facts: { ...analysis.source, frames: analysis.source.frames + 1 },
        size: identity.size,
        mtimeMs: identity.mtimeMs
      })
    ).toBeNull()
  })

  it('rejects malformed envelope bytes and amplitude claims', () => {
    const { encoded, analysis } = fixture()
    const badLength = parse(encoded)
    badLength.envelope.data = Buffer.alloc(7).toString('base64')
    expect(decode(JSON.stringify(badLength), analysis)).toBeNull()

    const nonFinite = parse(encoded)
    const bytes = Buffer.from(nonFinite.envelope.data, 'base64')
    bytes.writeFloatLE(Number.NaN, 0)
    nonFinite.envelope.data = bytes.toString('base64')
    expect(decode(JSON.stringify(nonFinite), analysis)).toBeNull()

    const inverted = parse(encoded)
    const invertedBytes = Buffer.from(inverted.envelope.data, 'base64')
    invertedBytes.writeFloatLE(0.75, 0)
    invertedBytes.writeFloatLE(-0.75, 4)
    inverted.envelope.data = invertedBytes.toString('base64')
    expect(decode(JSON.stringify(inverted), analysis)).toBeNull()
  })

  it('requires canonical base64 and the production bucket partition', () => {
    const { encoded } = fixture()
    const missingPadding = parse(encoded)
    missingPadding.envelope.data = missingPadding.envelope.data.replace(/=$/u, '')
    expect(decode(JSON.stringify(missingPadding))).toBeNull()

    const extraPadding = parse(encoded)
    extraPadding.envelope.data += '='
    expect(decode(JSON.stringify(extraPadding))).toBeNull()

    const shortEnvelope = parse(encoded)
    const bytes = Buffer.from(shortEnvelope.envelope.data, 'base64').subarray(0, -8)
    shortEnvelope.envelope.buckets -= 1
    shortEnvelope.envelope.data = bytes.toString('base64')
    expect(decode(JSON.stringify(shortEnvelope))).toBeNull()
  })

  it('rejects impossible legacy source facts without stored track metadata', () => {
    const { encoded } = fixture()
    const inexactDuration = parse(encoded)
    inexactDuration.source.durationSec += 0.001
    inexactDuration.envelope.durationSec = inexactDuration.source.durationSec
    expect(decodeWithoutFacts(JSON.stringify(inexactDuration))).toBeNull()

    const standardWithExtensibleFields = parse(encoded)
    standardWithExtensibleFields.source.validBitsPerSample = 32
    standardWithExtensibleFields.source.channelMask = 1
    expect(decodeWithoutFacts(JSON.stringify(standardWithExtensibleFields))).toBeNull()

    const incompleteExtensible = parse(encoded)
    incompleteExtensible.source.formatTag = 0xfffe
    expect(decodeWithoutFacts(JSON.stringify(incompleteExtensible))).toBeNull()

    const invalidChannelMask = parse(encoded)
    invalidChannelMask.source.formatTag = 0xfffe
    invalidChannelMask.source.validBitsPerSample = 32
    invalidChannelMask.source.channelMask = 0x1_0000_0000
    expect(decodeWithoutFacts(JSON.stringify(invalidChannelMask))).toBeNull()
  })

  it('rejects invalid audible bounds', () => {
    const { encoded, analysis } = fixture()
    const persisted = parse(encoded)
    persisted.audible = {
      ...persisted.audible,
      classification: 'audible',
      detectedStartFrame: 80,
      detectedEndFrameExclusive: 20,
      startFrame: 80,
      endFrameExclusive: 20,
      audibleDurationSec: -0.06
    }
    expect(decode(JSON.stringify(persisted), analysis)).toBeNull()

    const wrongWindow = parse(encoded)
    wrongWindow.audible.windowFrames += 1
    expect(decode(JSON.stringify(wrongWindow), analysis)).toBeNull()

    const contradictorySilent = parse(encoded)
    contradictorySilent.audible.classification = 'silent'
    expect(decode(JSON.stringify(contradictorySilent), analysis)).toBeNull()

    const misalignedStart = parse(encoded)
    misalignedStart.audible.detectedStartFrame = 1
    expect(decode(JSON.stringify(misalignedStart), analysis)).toBeNull()

    const impossibleOpenRun = parse(encoded)
    impossibleOpenRun.audible.detectedStartFrame = 70
    impossibleOpenRun.audible.startFrame = 20
    impossibleOpenRun.audible.leadingSilenceSec = 0.02
    impossibleOpenRun.audible.audibleDurationSec = 0.08
    expect(decode(JSON.stringify(impossibleOpenRun), analysis)).toBeNull()

    const inexactSeconds = parse(encoded)
    inexactSeconds.audible.audibleDurationSec += 0.001
    expect(decode(JSON.stringify(inexactSeconds), analysis)).toBeNull()
  })

  it('rejects impossible level and clipping statistics', () => {
    const { encoded, analysis } = fixture()
    const impossibleRms = parse(encoded)
    impossibleRms.rmsAmplitude = impossibleRms.peakAmplitude + 1
    expect(decode(JSON.stringify(impossibleRms), analysis)).toBeNull()

    const falseClipping = parse(encoded)
    falseClipping.clippedSamples = 1
    expect(decode(JSON.stringify(falseClipping), analysis)).toBeNull()

    const zeroRms = parse(encoded)
    zeroRms.rmsAmplitude = 0
    expect(decode(JSON.stringify(zeroRms), analysis)).toBeNull()

    const understatedEnvelope = parse(encoded)
    const understatedBytes = Buffer.from(understatedEnvelope.envelope.data, 'base64')
    for (let index = 8; index < understatedBytes.length; index += 8) {
      understatedBytes.writeFloatLE(0, index)
      understatedBytes.writeFloatLE(0, index + 4)
    }
    understatedEnvelope.envelope.data = understatedBytes.toString('base64')
    expect(decode(JSON.stringify(understatedEnvelope), analysis)).toBeNull()

    const impossibleClipEnergy = parse(encoded)
    impossibleClipEnergy.peakAmplitude = 2
    impossibleClipEnergy.clippedSamples = analysis.source.frames
    impossibleClipEnergy.rmsAmplitude = 0.1
    expect(decode(JSON.stringify(impossibleClipEnergy), analysis)).toBeNull()
  })
})
