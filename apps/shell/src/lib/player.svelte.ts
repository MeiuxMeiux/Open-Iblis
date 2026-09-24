// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LibraryTrack } from '../../shared/contract'

type PlayerPhase =
  'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'waiting' | 'seeking' | 'ended' | 'error'

export interface MediaRange {
  startSec: number
  endSec: number
}

export interface PlayerHostAdapter {
  load(id: string, autoplay: boolean): void
  play(): void
  pause(): void
  seek(timeSec: number): void
  setVolume(volume: number): void
  setPlaybackRate(rate: number): void
  unload(): Promise<void>
}

interface PlayerMediaObservation {
  durationSec: number
  buffered: MediaRange[]
  seekable: MediaRange[]
}

export interface PlayerStore {
  readonly track: LibraryTrack | null
  readonly activeId: string | null
  readonly phase: PlayerPhase
  readonly playIntent: boolean
  readonly currentTimeSec: number
  readonly previewTimeSec: number | null
  readonly displayTimeSec: number
  readonly durationSec: number | null
  readonly buffered: MediaRange[]
  readonly seekable: MediaRange[]
  readonly canSeek: boolean
  readonly volume: number
  readonly muted: boolean
  readonly playbackRate: number
  readonly previousTrack: LibraryTrack | null
  readonly nextTrack: LibraryTrack | null
  readonly error: string | null
  attachHost(adapter: PlayerHostAdapter): () => void
  toggle(track: LibraryTrack): void
  select(track: LibraryTrack, autoplay?: boolean): void
  previous(): void
  next(): void
  play(): void
  pause(): void
  toggleMuted(): void
  setVolume(volume: number): void
  setPlaybackRate(rate: number): void
  previewSeek(timeSec: number | null): void
  commitSeek(timeSec: number): void
  unloadIfActive(id: string): Promise<void>
  updateTrack(track: LibraryTrack): void
  updateTracks(tracks: LibraryTrack[]): void
  mediaLoadStart(): void
  mediaObserved(observation: PlayerMediaObservation): void
  mediaTime(timeSec: number): void
  mediaPlaying(): void
  mediaPaused(): void
  mediaWaiting(): void
  mediaSeeked(timeSec: number, paused: boolean): void
  mediaEnded(): void
  mediaError(message: string): void
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function validRanges(ranges: MediaRange[], durationSec: number): MediaRange[] {
  return ranges.flatMap((range) => {
    if (!Number.isFinite(range.startSec) || !Number.isFinite(range.endSec)) return []
    const startSec = clamp(range.startSec, 0, durationSec)
    const endSec = clamp(range.endSec, 0, durationSec)
    return endSec > startSec ? [{ startSec, endSec }] : []
  })
}

export function createPlayerStore(): PlayerStore {
  let track = $state<LibraryTrack | null>(null)
  let libraryTracks = $state<LibraryTrack[]>([])
  let phase = $state<PlayerPhase>('idle')
  let playIntent = $state(false)
  let currentTimeSec = $state(0)
  let previewTimeSec = $state<number | null>(null)
  let durationSec = $state<number | null>(null)
  let buffered = $state<MediaRange[]>([])
  let seekable = $state<MediaRange[]>([])
  let volume = $state(1)
  let muted = $state(false)
  let lastAudibleVolume = 1
  let playbackRate = $state(1)
  let error = $state<string | null>(null)
  let adapter: PlayerHostAdapter | null = null

  function resetMedia(): void {
    phase = track ? 'loading' : 'idle'
    currentTimeSec = 0
    previewTimeSec = null
    durationSec = null
    buffered = []
    seekable = []
    error = null
  }

  function clampTime(value: number): number {
    return durationSec === null ? Math.max(0, value) : clamp(value, 0, durationSec)
  }

  function clampSeekTime(value: number): number {
    const target = clampTime(value)
    const containing = seekable.find((range) => target >= range.startSec && target <= range.endSec)
    if (containing) return target

    let closest = seekable[0]?.startSec ?? target
    let distance = Math.abs(target - closest)
    for (const range of seekable) {
      for (const boundary of [range.startSec, range.endSec]) {
        const nextDistance = Math.abs(target - boundary)
        if (nextDistance < distance) {
          closest = boundary
          distance = nextDistance
        }
      }
    }
    return closest
  }

  function adjacentTrack(offset: -1 | 1): LibraryTrack | null {
    const activeId = track?.id
    if (!activeId) return null
    const index = libraryTracks.findIndex((candidate) => candidate.id === activeId)
    if (index === -1) return null
    return libraryTracks[index + offset] ?? null
  }

  function normalizedPlaybackRate(value: number): number {
    return Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1
  }

  const store: PlayerStore = {
    get track() {
      return track
    },
    get activeId() {
      return track?.id ?? null
    },
    get phase() {
      return phase
    },
    get playIntent() {
      return playIntent
    },
    get currentTimeSec() {
      return currentTimeSec
    },
    get previewTimeSec() {
      return previewTimeSec
    },
    get displayTimeSec() {
      return previewTimeSec ?? currentTimeSec
    },
    get durationSec() {
      return durationSec
    },
    get buffered() {
      return buffered
    },
    get seekable() {
      return seekable
    },
    get canSeek() {
      return durationSec !== null && durationSec > 0 && seekable.length > 0
    },
    get volume() {
      return volume
    },
    get muted() {
      return muted
    },
    get playbackRate() {
      return playbackRate
    },
    get previousTrack() {
      return adjacentTrack(-1)
    },
    get nextTrack() {
      return adjacentTrack(1)
    },
    get error() {
      return error
    },

    attachHost(nextAdapter) {
      adapter = nextAdapter
      adapter.setVolume(muted ? 0 : volume)
      adapter.setPlaybackRate(playbackRate)
      if (track) adapter.load(track.id, playIntent)
      return () => {
        if (adapter === nextAdapter) adapter = null
      }
    },

    toggle(nextTrack) {
      if (track?.id !== nextTrack.id) {
        store.select(nextTrack)
      } else if (playIntent) {
        store.pause()
      } else {
        store.play()
      }
    },

    select(nextTrack, autoplay = true) {
      track = nextTrack
      playIntent = autoplay
      resetMedia()
      adapter?.load(nextTrack.id, autoplay)
    },

    previous() {
      const target = adjacentTrack(-1)
      if (target) store.select(target, true)
    },

    next() {
      const target = adjacentTrack(1)
      if (target) store.select(target, true)
    },

    play() {
      if (!track) return
      playIntent = true
      error = null
      adapter?.play()
    },

    pause() {
      if (!track) return
      playIntent = false
      adapter?.pause()
    },

    toggleMuted() {
      if (muted) {
        muted = false
        if (volume === 0) volume = lastAudibleVolume
      } else {
        muted = true
      }
      adapter?.setVolume(muted ? 0 : volume)
    },

    setVolume(nextVolume) {
      volume = clamp(nextVolume, 0, 1)
      muted = volume === 0
      if (volume > 0) lastAudibleVolume = volume
      adapter?.setVolume(muted ? 0 : volume)
    },

    setPlaybackRate(nextRate) {
      playbackRate = normalizedPlaybackRate(nextRate)
      adapter?.setPlaybackRate(playbackRate)
    },

    previewSeek(timeSec) {
      previewTimeSec = timeSec === null || !store.canSeek ? null : clampSeekTime(timeSec)
    },

    commitSeek(timeSec) {
      if (!store.canSeek || phase === 'seeking') return
      const target = clampSeekTime(timeSec)
      previewTimeSec = target
      phase = 'seeking'
      adapter?.seek(target)
    },

    async unloadIfActive(id) {
      if (track?.id !== id) return
      playIntent = false
      track = null
      resetMedia()
      await adapter?.unload()
    },

    updateTrack(nextTrack) {
      const index = libraryTracks.findIndex((candidate) => candidate.id === nextTrack.id)
      if (index !== -1) libraryTracks[index] = nextTrack
      if (track?.id === nextTrack.id) track = nextTrack
    },

    updateTracks(nextTracks) {
      libraryTracks = [...nextTracks]
      if (!track) return
      const updated = libraryTracks.find((candidate) => candidate.id === track?.id)
      if (updated) track = updated
    },

    mediaLoadStart() {
      if (!track) return
      resetMedia()
    },

    mediaObserved({ durationSec: nextDuration, buffered: nextBuffered, seekable: nextSeekable }) {
      if (!track || !Number.isFinite(nextDuration) || nextDuration <= 0) return
      durationSec = nextDuration
      buffered = validRanges(nextBuffered, nextDuration)
      seekable = validRanges(nextSeekable, nextDuration)
      if (phase === 'loading') phase = 'ready'
    },

    mediaTime(timeSec) {
      if (!track || !Number.isFinite(timeSec)) return
      currentTimeSec = clampTime(timeSec)
    },

    mediaPlaying() {
      if (!track) return
      playIntent = true
      phase = 'playing'
      error = null
    },

    mediaPaused() {
      if (!track || phase === 'ended') return
      phase = 'paused'
    },

    mediaWaiting() {
      if (track) phase = 'waiting'
    },

    mediaSeeked(timeSec, paused) {
      if (!track) return
      currentTimeSec = clampTime(timeSec)
      previewTimeSec = null
      playIntent = !paused
      phase = paused ? 'paused' : 'playing'
    },

    mediaEnded() {
      if (!track) return
      currentTimeSec = durationSec ?? currentTimeSec
      previewTimeSec = null
      playIntent = false
      phase = 'ended'
    },

    mediaError(message) {
      if (!track) return
      playIntent = false
      phase = 'error'
      error = message
    }
  }

  return store
}

export const player = createPlayerStore()
