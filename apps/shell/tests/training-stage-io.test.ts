// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { MAX_TRACKS_HARD_STOP } from '../shared/training'
import { probeScanParams } from '../electron/main/training/stage-io'

describe('probeScanParams (Open-Iblis #9)', () => {
  it('hands the folder-picker probe a scratch dir so packs up to 0.1.1 accept it', () => {
    const params = probeScanParams('C:/Music/mine', 'C:/Iblis/training/probe-x')
    expect(params).toEqual({
      scratch: 'C:/Iblis/training/probe-x',
      source: 'C:/Music/mine',
      ingest: false,
      maxTracks: MAX_TRACKS_HARD_STOP
    })
  })

  it('never asks the probe to ingest (copy) tracks', () => {
    expect(probeScanParams('a', 'b').ingest).toBe(false)
  })
})
