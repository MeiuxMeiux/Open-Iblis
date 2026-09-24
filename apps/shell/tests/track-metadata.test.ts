// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../shared/contract'
import { targetMusicalMetadata } from '../src/lib/library/track-metadata'

function track(config?: LibraryTrack['config']): LibraryTrack {
  return {
    id: 'track',
    name: 'Track',
    prompt: 'test',
    createdAt: 1,
    rating: 0,
    format: 'wav',
    tags: [],
    ...(config ? { config } : {})
  }
}

describe('target musical metadata', () => {
  it('returns only finite generation targets', () => {
    expect(targetMusicalMetadata(track({ bpm: 174, keyscale: ' F minor ' }))).toEqual({
      bpm: 174,
      key: 'F minor'
    })
    expect(targetMusicalMetadata(track({ bpm: Number.NaN, keyscale: '  ' }))).toEqual({})
    expect(targetMusicalMetadata(null)).toEqual({})
  })

  it('ignores a malformed persisted key target', () => {
    const malformed = track({ keyscale: 42 as unknown as string })
    expect(targetMusicalMetadata(malformed)).toEqual({})
  })
})
