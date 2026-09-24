<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { MediaObservation } from '../../../shared/contract'
  import { player, type MediaRange, type PlayerHostAdapter } from '../player.svelte'
  import PlayerTransport from './PlayerTransport.svelte'

  let audio = $state<HTMLAudioElement>()
  let sourceId: string | null = null
  let sourceEpoch = 0
  let frame = 0
  let lastObservation = ''

  const boundAudio = (): HTMLAudioElement | undefined => audio

  function currentSource(): boolean {
    if (!audio || !sourceId || !audio.currentSrc) return false
    try {
      const url = new URL(audio.currentSrc)
      return url.hostname === sourceId && url.searchParams.get('load') === String(sourceEpoch)
    } catch {
      return false
    }
  }

  function ranges(value: TimeRanges): MediaRange[] {
    const result: MediaRange[] = []
    for (let i = 0; i < value.length; i++) {
      result.push({ startSec: value.start(i), endSec: value.end(i) })
    }
    return result
  }

  function observeMedia(): void {
    if (!audio || !currentSource() || !Number.isFinite(audio.duration) || audio.duration <= 0)
      return
    const buffered = ranges(audio.buffered)
    const seekable = ranges(audio.seekable)
    player.mediaObserved({ durationSec: audio.duration, buffered, seekable })

    const last = seekable.at(-1)
    const observation: MediaObservation = {
      durationSec: audio.duration,
      seekable: !!last,
      ...(last ? { seekableStartSec: last.startSec, seekableEndSec: last.endSec } : {})
    }
    const key = `${sourceId}:${JSON.stringify(observation)}`
    if (key === lastObservation || !sourceId) return
    lastObservation = key
    void window.iblis.library.mediaObserved(sourceId, observation)
  }

  function stopClock(): void {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  function startClock(): void {
    stopClock()
    const tick = (): void => {
      if (!audio || !currentSource() || audio.paused || audio.ended) {
        frame = 0
        return
      }
      player.mediaTime(audio.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }

  function reportPlayError(id: string, epoch: number, error: unknown): void {
    if (
      sourceId !== id ||
      sourceEpoch !== epoch ||
      (error as DOMException | null | undefined)?.name === 'AbortError'
    ) {
      return
    }
    player.mediaError(error instanceof Error ? error.message : 'Audio playback failed')
  }

  function waitForEmptied(): Promise<void> {
    if (!audio) return Promise.resolve()
    const media = audio
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timeout)
        media.removeEventListener('emptied', finish)
        resolve()
      }
      const timeout = setTimeout(finish, 80)
      media.addEventListener('emptied', finish, { once: true })
    })
  }

  function mediaError(): void {
    if (!audio || !currentSource()) return
    const code = audio.error?.code
    const message = code
      ? `Audio could not be played (media error ${code})`
      : 'Audio could not be played'
    player.mediaError(message)
  }

  const adapter: PlayerHostAdapter = {
    load(id, autoplay) {
      if (!audio) return
      sourceId = null
      const epoch = ++sourceEpoch
      stopClock()
      audio.pause()
      lastObservation = ''
      sourceId = id
      audio.src = `iblis-track://${id}?load=${epoch}`
      audio.load()
      if (autoplay) void audio.play().catch((error: unknown) => reportPlayError(id, epoch, error))
    },
    play() {
      if (!audio || !sourceId) return
      const id = sourceId
      const epoch = sourceEpoch
      void audio.play().catch((error: unknown) => reportPlayError(id, epoch, error))
    },
    pause() {
      audio?.pause()
    },
    seek(timeSec) {
      if (audio && currentSource()) audio.currentTime = timeSec
    },
    setVolume(volume) {
      if (audio) audio.volume = volume
    },
    setPlaybackRate(rate) {
      if (!audio) return
      audio.preservesPitch = true
      audio.defaultPlaybackRate = rate
      audio.playbackRate = rate
    },
    async unload() {
      if (!audio) return
      sourceId = null
      sourceEpoch++
      stopClock()
      audio.pause()
      const emptied = waitForEmptied()
      audio.removeAttribute('src')
      audio.load()
      await emptied
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }

  // Space toggles play, M toggles mute, unless a control or text field has focus.
  function keyboard(event: KeyboardEvent): void {
    if (
      !player.track ||
      event.defaultPrevented ||
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return
    }
    const target = event.target
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        !!target.closest('button, input, textarea, select, a, [role="button"], [role="slider"]'))
    ) {
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      if (player.playIntent) player.pause()
      else player.play()
    } else if (event.key.toLowerCase() === 'm') {
      event.preventDefault()
      player.toggleMuted()
    }
  }

  onMount(() => {
    // Guard through a call, not `audio` itself: narrowing would leak into the
    // cleanup closure, which must keep re-checking the live bind:this element.
    const mounted = boundAudio()
    if (!mounted) return
    mounted.preservesPitch = true
    const detach = player.attachHost(adapter)
    window.addEventListener('keydown', keyboard)

    return () => {
      window.removeEventListener('keydown', keyboard)
      detach()
      sourceId = null
      sourceEpoch++
      stopClock()
      audio?.pause()
      audio?.removeAttribute('src')
      audio?.load()
    }
  })
</script>

<audio
  bind:this={audio}
  preload="auto"
  onloadstart={() => currentSource() && player.mediaLoadStart()}
  onloadedmetadata={observeMedia}
  ondurationchange={observeMedia}
  onprogress={observeMedia}
  oncanplay={observeMedia}
  ontimeupdate={() => audio && currentSource() && player.mediaTime(audio.currentTime)}
  onplaying={() => {
    if (!currentSource()) return
    player.mediaPlaying()
    startClock()
  }}
  onpause={() => {
    if (!currentSource()) return
    stopClock()
    player.mediaPaused()
  }}
  onwaiting={() => currentSource() && player.mediaWaiting()}
  onstalled={() => currentSource() && player.mediaWaiting()}
  onseeked={() => {
    if (audio && currentSource()) player.mediaSeeked(audio.currentTime, audio.paused)
  }}
  onended={() => {
    if (!currentSource()) return
    stopClock()
    player.mediaEnded()
  }}
  onerror={mediaError}
></audio>
<PlayerTransport />

<style>
  audio {
    display: none;
  }
</style>
