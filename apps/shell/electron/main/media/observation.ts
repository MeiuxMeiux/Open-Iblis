// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MediaObservation, WavFacts } from '../../../shared/contract'

interface MediaReference {
  requestedDurationSec?: number
  durationSec?: number
  audio?: Pick<WavFacts, 'durationSec' | 'sampleRateHz'>
}

function finiteNonNegative(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0)
}

// Validate Chromium's report and combine it with the independently parsed RIFF
// facts. This is pure so diagnostics cannot silently drift from the tolerance
// used by tests and the later player.
export function mediaObservationFields(
  trackId: string,
  reference: MediaReference,
  observation: MediaObservation
): Record<string, unknown> {
  if (!Number.isFinite(observation.durationSec) || observation.durationSec <= 0) {
    throw new Error('browser media duration must be finite and positive')
  }
  if (typeof observation.seekable !== 'boolean') {
    throw new Error('browser seekable state must be boolean')
  }
  if (
    !finiteNonNegative(observation.seekableStartSec) ||
    !finiteNonNegative(observation.seekableEndSec) ||
    (observation.seekableStartSec !== undefined &&
      observation.seekableEndSec !== undefined &&
      observation.seekableEndSec < observation.seekableStartSec) ||
    (observation.seekable &&
      (observation.seekableStartSec === undefined || observation.seekableEndSec === undefined))
  ) {
    throw new Error('browser seekable range is invalid')
  }

  const containerDurationSec = reference.audio?.durationSec ?? reference.durationSec
  const deltaSec =
    containerDurationSec === undefined ? undefined : observation.durationSec - containerDurationSec
  const frameToleranceSec = reference.audio ? 1 / reference.audio.sampleRateHz : undefined
  return {
    trackId,
    requestedDurationSec: reference.requestedDurationSec,
    containerDurationSec,
    browserDurationSec: observation.durationSec,
    durationDeltaSec: deltaSec,
    withinOneFrame:
      deltaSec !== undefined && frameToleranceSec !== undefined
        ? Math.abs(deltaSec) <= frameToleranceSec
        : undefined,
    seekable: observation.seekable,
    seekableStartSec: observation.seekableStartSec,
    seekableEndSec: observation.seekableEndSec
  }
}
