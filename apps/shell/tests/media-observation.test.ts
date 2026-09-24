// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { mediaObservationFields } from '../electron/main/media/observation'

const reference = {
  requestedDurationSec: 30,
  durationSec: 30.5,
  audio: { durationSec: 30.5, sampleRateHz: 48000 }
}

describe('browser media diagnostics', () => {
  it('records requested, parsed, and browser durations with one-frame tolerance', () => {
    expect(
      mediaObservationFields('track-1', reference, {
        durationSec: 30.5 + 1 / 96000,
        seekable: true,
        seekableStartSec: 0,
        seekableEndSec: 30.5
      })
    ).toMatchObject({
      trackId: 'track-1',
      requestedDurationSec: 30,
      containerDurationSec: 30.5,
      browserDurationSec: 30.5 + 1 / 96000,
      withinOneFrame: true,
      seekable: true
    })

    expect(
      mediaObservationFields('track-1', reference, {
        durationSec: 30.51,
        seekable: false
      }).withinOneFrame
    ).toBe(false)
  })

  it('rejects non-finite durations and invalid seekable ranges', () => {
    expect(() =>
      mediaObservationFields('track-1', reference, { durationSec: Infinity, seekable: false })
    ).toThrow(/duration/)
    expect(() =>
      mediaObservationFields('track-1', reference, {
        durationSec: 30.5,
        seekable: 'yes' as unknown as boolean
      })
    ).toThrow(/seekable state/)
    expect(() =>
      mediaObservationFields('track-1', reference, {
        durationSec: 30.5,
        seekable: true
      })
    ).toThrow(/seekable range/)
    expect(() =>
      mediaObservationFields('track-1', reference, {
        durationSec: 30.5,
        seekable: true,
        seekableStartSec: 10,
        seekableEndSec: 5
      })
    ).toThrow(/seekable range/)
  })
})
