// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../shared/contract'
import { createPlayerStore, type PlayerHostAdapter } from '../src/lib/player.svelte'

function track(id: string, name = `Track ${id}`): LibraryTrack {
  return {
    id,
    name,
    prompt: 'instrumental test fixture',
    createdAt: 1,
    rating: 0,
    format: 'wav',
    tags: [],
    durationSec: 90
  }
}

function host(events: string[], unload?: () => Promise<void>): PlayerHostAdapter {
  return {
    load: (id, autoplay) => events.push(`load:${id}:${autoplay}`),
    play: () => events.push('play'),
    pause: () => events.push('pause'),
    seek: (timeSec) => events.push(`seek:${timeSec}`),
    setVolume: (volume) => events.push(`volume:${volume}`),
    setPlaybackRate: (rate) => events.push(`rate:${rate}`),
    unload: unload ?? (async () => void events.push('unload'))
  }
}

describe('persistent player store', () => {
  it('selects a new track and toggles one active source without unloading it', () => {
    const events: string[] = []
    const player = createPlayerStore()
    player.attachHost(host(events))

    expect(player.phase).toBe('idle')
    player.toggle(track('one'))

    expect(player.activeId).toBe('one')
    expect(player.track?.name).toBe('Track one')
    expect(player.phase).toBe('loading')
    expect(player.playIntent).toBe(true)
    expect(player.currentTimeSec).toBe(0)
    expect(player.durationSec).toBeNull()
    expect(events).toEqual(['volume:1', 'rate:1', 'load:one:true'])

    player.toggle(track('one'))
    expect(player.activeId).toBe('one')
    expect(player.playIntent).toBe(false)
    expect(events.at(-1)).toBe('pause')

    player.toggle(track('one'))
    expect(player.playIntent).toBe(true)
    expect(events.at(-1)).toBe('play')

    player.select(track('two'))
    expect(player.activeId).toBe('two')
    expect(player.durationSec).toBeNull()
    expect(player.seekable).toEqual([])
    expect(events.at(-1)).toBe('load:two:true')
  })

  it('uses browser duration and seekable ranges as the seek authority', () => {
    const events: string[] = []
    const player = createPlayerStore()
    player.attachHost(host(events))
    player.select(track('one'))

    player.previewSeek(40)
    player.commitSeek(40)
    expect(player.canSeek).toBe(false)
    expect(player.previewTimeSec).toBeNull()
    expect(events.some((event) => event.startsWith('seek:'))).toBe(false)

    player.mediaObserved({
      durationSec: 12.5,
      buffered: [{ startSec: 0, endSec: 4 }],
      seekable: [{ startSec: 0, endSec: 12.5 }]
    })
    expect(player.durationSec).toBe(12.5)
    expect(player.canSeek).toBe(true)

    // The record says 90 seconds, but the browser says 12.5. Browser wins.
    player.previewSeek(80)
    expect(player.previewTimeSec).toBe(12.5)
    player.commitSeek(80)
    expect(events.at(-1)).toBe('seek:12.5')
    expect(player.phase).toBe('seeking')
    expect(player.previewTimeSec).toBe(12.5)

    player.mediaSeeked(12.4, true)
    expect(player.previewTimeSec).toBeNull()
    expect(player.currentTimeSec).toBe(12.4)
    expect(player.phase).toBe('paused')
  })

  it('keeps seeks inside partial and gapped browser ranges', () => {
    const events: string[] = []
    const player = createPlayerStore()
    player.attachHost(host(events))
    player.select(track('one'))
    player.mediaObserved({
      durationSec: 20,
      buffered: [],
      seekable: [
        { startSec: 2, endSec: 5 },
        { startSec: 10, endSec: 18 }
      ]
    })

    player.previewSeek(0)
    expect(player.previewTimeSec).toBe(2)
    player.previewSeek(8)
    expect(player.previewTimeSec).toBe(10)
    player.commitSeek(6)
    expect(events.at(-1)).toBe('seek:5')
  })

  it('tracks actual media lifecycle separately from playback intent', () => {
    const player = createPlayerStore()
    player.attachHost(host([]))
    player.select(track('one'))

    player.mediaPlaying()
    player.mediaTime(3.25)
    expect(player.phase).toBe('playing')
    expect(player.currentTimeSec).toBe(3.25)

    player.mediaWaiting()
    expect(player.phase).toBe('waiting')
    player.mediaPaused()
    expect(player.phase).toBe('paused')

    player.mediaEnded()
    expect(player.phase).toBe('ended')
    expect(player.playIntent).toBe(false)
  })

  it('navigates the newest-first Library sequence with autoplay and no wrapping', () => {
    const events: string[] = []
    const player = createPlayerStore()
    player.attachHost(host(events))
    const newest = { ...track('newest'), createdAt: 3 }
    const middle = { ...track('middle'), createdAt: 2 }
    const oldest = { ...track('oldest'), createdAt: 1 }
    player.updateTracks([newest, middle, oldest])

    expect(player.previousTrack).toBeNull()
    expect(player.nextTrack).toBeNull()
    player.select(middle, false)
    expect(player.previousTrack?.id).toBe('newest')
    expect(player.nextTrack?.id).toBe('oldest')

    player.previous()
    expect(player.activeId).toBe('newest')
    expect(player.playIntent).toBe(true)
    expect(events.at(-1)).toBe('load:newest:true')
    expect(player.previousTrack).toBeNull()
    expect(player.nextTrack?.id).toBe('middle')

    const atStart = events.length
    player.previous()
    expect(events).toHaveLength(atStart)

    player.next()
    player.next()
    expect(player.activeId).toBe('oldest')
    expect(events.at(-1)).toBe('load:oldest:true')
    expect(player.previousTrack?.id).toBe('middle')
    expect(player.nextTrack).toBeNull()

    const atEnd = events.length
    player.next()
    expect(events).toHaveLength(atEnd)
  })

  it('updates navigation metadata and disables neighbors when the active track leaves the list', () => {
    const player = createPlayerStore()
    player.attachHost(host([]))
    player.updateTracks([track('one'), track('two')])
    player.select(track('one'), false)

    player.updateTrack(track('two', 'Renamed neighbor'))
    expect(player.nextTrack?.name).toBe('Renamed neighbor')

    player.updateTracks([track('two', 'Renamed neighbor')])
    expect(player.activeId).toBe('one')
    expect(player.previousTrack).toBeNull()
    expect(player.nextTrack).toBeNull()
  })

  it('clamps volume and keeps active track metadata current', () => {
    const events: string[] = []
    const player = createPlayerStore()
    player.attachHost(host(events))
    player.select(track('one'))

    player.setVolume(-2)
    expect(player.volume).toBe(0)
    player.setVolume(4)
    expect(player.volume).toBe(1)
    expect(events.slice(-2)).toEqual(['volume:0', 'volume:1'])

    player.setVolume(0.4)
    player.toggleMuted()
    expect(events.at(-1)).toBe('volume:0')
    player.toggleMuted()
    expect(player.volume).toBe(0.4)
    expect(events.at(-1)).toBe('volume:0.4')

    player.setVolume(0)
    player.toggleMuted()
    expect(player.volume).toBe(0.4)
    expect(events.at(-1)).toBe('volume:0.4')

    player.updateTrack(track('other', 'Wrong track'))
    expect(player.track?.name).toBe('Track one')
    player.updateTrack(track('one', 'Renamed track'))
    expect(player.track?.name).toBe('Renamed track')
  })

  it('clamps playback rate and reapplies it when a host attaches', () => {
    const firstEvents: string[] = []
    const player = createPlayerStore()
    player.attachHost(host(firstEvents))

    player.setPlaybackRate(0.25)
    expect(player.playbackRate).toBe(0.5)
    expect(firstEvents.at(-1)).toBe('rate:0.5')
    player.setPlaybackRate(4)
    expect(player.playbackRate).toBe(2)
    expect(firstEvents.at(-1)).toBe('rate:2')
    player.setPlaybackRate(Number.NaN)
    expect(player.playbackRate).toBe(1)

    const nextEvents: string[] = []
    player.attachHost(host(nextEvents))
    expect(nextEvents).toEqual(['volume:1', 'rate:1'])
  })

  it('awaits host unload before callers may delete and cannot clear a newer selection', async () => {
    const events: string[] = []
    let releaseUnload = (): void => {}
    const blocked = new Promise<void>((resolve) => {
      releaseUnload = resolve
    })
    const player = createPlayerStore()
    player.attachHost(
      host(events, async () => {
        events.push('unload:start')
        await blocked
        events.push('unload:released')
      })
    )
    player.select(track('one'))

    const removal = player.unloadIfActive('one').then(() => events.push('delete:allowed'))
    await Promise.resolve()
    expect(events).toContain('unload:start')
    expect(events).not.toContain('delete:allowed')
    expect(player.activeId).toBeNull()

    // A user can select another row while the old protocol stream settles.
    player.select(track('two'))
    releaseUnload()
    await removal
    expect(events.slice(-2)).toEqual(['unload:released', 'delete:allowed'])
    expect(player.activeId).toBe('two')
  })

  it('clears a deleting selection even when host unload fails', async () => {
    const player = createPlayerStore()
    player.attachHost(
      host([], async () => {
        throw new Error('media host failed')
      })
    )
    player.select(track('one'))

    await expect(player.unloadIfActive('one')).rejects.toThrow('media host failed')
    expect(player.activeId).toBeNull()
    expect(player.phase).toBe('idle')
    expect(player.playIntent).toBe(false)
  })
})
