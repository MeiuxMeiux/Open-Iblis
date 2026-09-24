// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIBRARY_DISPLAY,
  DEFAULT_PLAYER_DISPLAY,
  readDisplayPreferences,
  writeLibraryDisplayPreferences,
  writePlayerDisplayPreferences
} from '../src/lib/display-preferences'

function fakeStorage(seed: Record<string, string> = {}): {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
} {
  const values = new Map(Object.entries(seed))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value)
  }
}

describe('display preferences', () => {
  it('defaults to visible musical targets and a hidden Library seed', () => {
    expect(readDisplayPreferences(fakeStorage())).toEqual({
      version: 1,
      player: DEFAULT_PLAYER_DISPLAY,
      library: DEFAULT_LIBRARY_DISPLAY
    })
    expect(DEFAULT_LIBRARY_DISPLAY.showSeed).toBe(false)
  })

  it('sanitizes malformed fields without discarding valid choices', () => {
    const storage = fakeStorage({
      'iblis.display.v1': JSON.stringify({
        version: 99,
        player: {
          waveformMode: 'mirrored',
          volumeStyle: 'meter',
          playbackRate: 1.25,
          showVolume: false,
          showFormat: 'yes'
        },
        library: { showSeed: true, showDate: null, sortOrder: 'loudness' }
      })
    })

    expect(readDisplayPreferences(storage)).toMatchObject({
      version: 1,
      player: {
        waveformMode: 'mirrored',
        volumeStyle: 'slider',
        playbackRate: 1.25,
        showVolume: false,
        showFormat: true
      },
      library: {
        showSeed: true,
        showDate: true,
        showDetectedAnalysis: true,
        sortOrder: 'newest'
      }
    })
  })

  it('survives malformed JSON', () => {
    expect(readDisplayPreferences(fakeStorage({ 'iblis.display.v1': '{bad json' }))).toEqual({
      version: 1,
      player: DEFAULT_PLAYER_DISPLAY,
      library: DEFAULT_LIBRARY_DISPLAY
    })
  })

  it('updates player and Library sections without clobbering each other', () => {
    const storage = fakeStorage()
    writeLibraryDisplayPreferences({ ...DEFAULT_LIBRARY_DISPLAY, showSeed: true }, storage)
    writePlayerDisplayPreferences(
      {
        ...DEFAULT_PLAYER_DISPLAY,
        waveformMode: 'timeline',
        volumeStyle: 'knob',
        playbackRate: 2
      },
      storage
    )

    expect(readDisplayPreferences(storage)).toMatchObject({
      player: { waveformMode: 'timeline', volumeStyle: 'knob', playbackRate: 2 },
      library: { showSeed: true }
    })
  })
})
