// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { ProcessorResultRecord } from '../shared/processors'
import { detectedTrackFacts } from '../shared/processors'
import { detectedMusicalMetadata } from '../src/lib/library/track-metadata'
import { sortTracks } from '../src/lib/library/track-sort'
import { matchesTrackQuery } from '../src/lib/library/track-search'
import type { LibraryTrack } from '../shared/contract'

function bpmResult(
  pluginId: string,
  bpm: number,
  computedAt: number,
  trackId = 't1'
): ProcessorResultRecord {
  return {
    trackId,
    pluginId,
    pluginVersion: '1.0.0',
    resultSchema: 1,
    sourceSha256: 'a'.repeat(64),
    configHash: 'b'.repeat(64),
    computedAt,
    computeMs: 5,
    capability: 'bpm-detect',
    value: { schemaVersion: 1, bpm, confidence: null, alternatives: [] }
  }
}

function keyResult(
  pluginId: string,
  pitchClass: 'F#',
  mode: 'minor',
  computedAt: number
): ProcessorResultRecord {
  return {
    trackId: 't1',
    pluginId,
    pluginVersion: '1.0.0',
    resultSchema: 1,
    sourceSha256: 'a'.repeat(64),
    configHash: 'b'.repeat(64),
    computedAt,
    computeMs: 5,
    capability: 'key-detect',
    value: { schemaVersion: 1, pitchClass, mode, confidence: 0.8, alternatives: [] }
  }
}

const track = (extra: Partial<LibraryTrack>): LibraryTrack => ({
  id: 't1',
  name: 'Take one',
  prompt: 'warm pads',
  createdAt: 1,
  rating: 0,
  format: 'wav',
  tags: [],
  ...extra
})

describe('detectedTrackFacts', () => {
  const defaults = { 'bpm-detect': 'mx.iblis.dsp', 'key-detect': 'mx.iblis.dsp' } as const

  it('surfaces the newest result from the current default provider only', () => {
    const facts = detectedTrackFacts(
      [
        bpmResult('mx.iblis.dsp', 120, 10),
        bpmResult('mx.iblis.dsp', 124, 20),
        bpmResult('mx.other', 999, 30),
        keyResult('mx.iblis.dsp', 'F#', 'minor', 15)
      ],
      defaults
    )
    expect(facts).toEqual({ bpm: 124, keyPitchClass: 'F#', keyMode: 'minor' })
  })

  it('returns null with no default provider or no matching results', () => {
    expect(detectedTrackFacts([bpmResult('mx.other', 90, 1)], defaults)).toBeNull()
    expect(detectedTrackFacts([bpmResult('mx.iblis.dsp', 90, 1)], {})).toBeNull()
  })

  it('keeps capabilities independent', () => {
    const facts = detectedTrackFacts([keyResult('mx.iblis.dsp', 'F#', 'minor', 5)], defaults)
    expect(facts).toEqual({ keyPitchClass: 'F#', keyMode: 'minor' })
  })
})

describe('detectedMusicalMetadata', () => {
  it('formats measured values compactly and never invents them', () => {
    expect(detectedMusicalMetadata(track({}))).toEqual({})
    expect(detectedMusicalMetadata(track({ detected: { bpm: 128 } }))).toEqual({ bpm: '128 BPM' })
    expect(detectedMusicalMetadata(track({ detected: { bpm: 127.84 } }))).toEqual({
      bpm: '127.8 BPM'
    })
    expect(
      detectedMusicalMetadata(track({ detected: { keyPitchClass: 'F#', keyMode: 'minor' } }))
    ).toEqual({ key: 'F# minor' })
  })
})

describe('sortTracks', () => {
  const a = track({ id: 'a', name: 'Alpha', detected: { bpm: 140 } })
  const b = track({ id: 'b', name: 'zeta' })
  const c = track({ id: 'c', name: 'Beta', detected: { bpm: 92 } })

  it('keeps newest-first untouched and reverses for oldest', () => {
    expect(sortTracks([a, b, c], 'newest').map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(sortTracks([a, b, c], 'oldest').map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts by name case-insensitively', () => {
    expect(sortTracks([a, b, c], 'name').map((t) => t.id)).toEqual(['a', 'c', 'b'])
  })

  it('sorts by detected BPM with unanalyzed tracks last, order preserved', () => {
    expect(sortTracks([a, b, c], 'bpm').map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('never mutates the input list', () => {
    const input = [a, b, c]
    sortTracks(input, 'name')
    expect(input.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('search over detected facts', () => {
  it('matches detected bpm and key text', () => {
    const analyzed = track({ detected: { bpm: 128.2, keyPitchClass: 'F#', keyMode: 'minor' } })
    expect(matchesTrackQuery(analyzed, '128 bpm')).toBe(true)
    expect(matchesTrackQuery(analyzed, 'f# minor')).toBe(true)
    expect(matchesTrackQuery(analyzed, '92 bpm')).toBe(false)
    expect(matchesTrackQuery(track({}), 'f# minor')).toBe(false)
  })
})
