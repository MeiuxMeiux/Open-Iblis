// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { matchesTrackQuery } from '../src/lib/library/track-search'

const track = {
  name: 'Midnight Chrome',
  prompt: 'Slow industrial techno with a glassy bassline',
  tags: ['generated', 'night-drive']
}

describe('matchesTrackQuery', () => {
  it('keeps every track for an empty search', () => {
    expect(matchesTrackQuery(track, '  ')).toBe(true)
  })

  it('matches names, prompts, and tags without case sensitivity', () => {
    expect(matchesTrackQuery(track, 'chrome')).toBe(true)
    expect(matchesTrackQuery(track, 'GLASSY')).toBe(true)
    expect(matchesTrackQuery(track, 'night-drive')).toBe(true)
  })

  it('does not match unrelated terms', () => {
    expect(matchesTrackQuery(track, 'orchestra')).toBe(false)
  })
})
