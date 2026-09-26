// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Synchronized audition of one stem set: one <audio> per stem, the first as
// the clock, the rest nudged back when they drift. Solo and mute follow DAW
// rules (any solo wins). The main player and the mixer never play together:
// starting one pauses the other.

import type { StemRole } from '@iblis/plugin-sdk'
import type { StemSetView } from '../../../shared/stems'
import { player } from '../player.svelte'

const DRIFT_SEC = 0.045

export interface LaneState {
  muted: boolean
  solo: boolean
  gain: number
}

function stemUrl(trackId: string, setId: string, role: StemRole): string {
  return `iblis-stem://${trackId}/${setId}/${role}`
}

export function laneAudible(role: StemRole, lanes: Record<string, LaneState>): boolean {
  const anySolo = Object.values(lanes).some((lane) => lane.solo)
  const lane = lanes[role]
  if (!lane) return false
  return anySolo ? lane.solo : !lane.muted
}

export class StemMixer {
  playing = $state(false)
  position = $state(0)
  duration = $state(0)
  loading = $state(true)
  error = $state<string | null>(null)
  lanes = $state<Record<string, LaneState>>({})

  private readonly elements = new Map<StemRole, HTMLAudioElement>()
  private frame = 0
  private ready = 0

  constructor(
    readonly trackId: string,
    readonly set: StemSetView
  ) {
    this.duration = set.stems[0]?.durationSec ?? 0
    for (const stem of set.stems) {
      this.lanes[stem.role] = { muted: false, solo: false, gain: 1 }
      const audio = new Audio()
      audio.preload = 'auto'
      audio.src = stemUrl(trackId, set.id, stem.role)
      audio.addEventListener('canplaythrough', () => this.markReady(), { once: true })
      audio.addEventListener('error', () => (this.error = 'A stem could not be loaded.'))
      audio.addEventListener('ended', () => this.ended())
      this.elements.set(stem.role, audio)
    }
  }

  private markReady(): void {
    this.ready++
    if (this.ready >= this.elements.size) this.loading = false
  }

  private get clock(): HTMLAudioElement | undefined {
    return this.elements.values().next().value
  }

  private applyVolumes(): void {
    for (const [role, audio] of this.elements) {
      const lane = this.lanes[role]
      audio.volume = laneAudible(role, this.lanes) && lane ? Math.max(0, Math.min(1, lane.gain)) : 0
    }
  }

  async play(): Promise<void> {
    if (this.playing) return
    player.pause()
    this.applyVolumes()
    if (this.position >= this.duration - 0.05) this.position = 0
    for (const audio of this.elements.values()) audio.currentTime = this.position
    this.playing = true
    try {
      await Promise.all([...this.elements.values()].map((audio) => audio.play()))
    } catch {
      this.pause()
      this.error = 'Playback could not start.'
      return
    }
    this.tick()
  }

  pause(): void {
    this.playing = false
    cancelAnimationFrame(this.frame)
    for (const audio of this.elements.values()) audio.pause()
    const clock = this.clock
    if (clock) this.position = clock.currentTime
  }

  toggle(): void {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(seconds: number): void {
    this.position = Math.max(0, Math.min(this.duration, seconds))
    for (const audio of this.elements.values()) audio.currentTime = this.position
  }

  toggleMute(role: StemRole): void {
    const lane = this.lanes[role]
    if (lane) lane.muted = !lane.muted
    this.applyVolumes()
  }

  toggleSolo(role: StemRole): void {
    const lane = this.lanes[role]
    if (lane) lane.solo = !lane.solo
    this.applyVolumes()
  }

  setGain(role: StemRole, gain: number): void {
    const lane = this.lanes[role]
    if (lane) lane.gain = gain
    this.applyVolumes()
  }

  private ended(): void {
    this.pause()
    this.position = 0
  }

  private tick = (): void => {
    if (!this.playing) return
    // The main player took over: step aside rather than play on top of it.
    if (player.phase === 'playing') {
      this.pause()
      return
    }
    const clock = this.clock
    if (clock) {
      this.position = clock.currentTime
      for (const audio of this.elements.values()) {
        if (audio !== clock && Math.abs(audio.currentTime - clock.currentTime) > DRIFT_SEC) {
          audio.currentTime = clock.currentTime
        }
      }
    }
    this.frame = requestAnimationFrame(this.tick)
  }

  destroy(): void {
    this.pause()
    for (const audio of this.elements.values()) {
      audio.removeAttribute('src')
      audio.load()
    }
    this.elements.clear()
  }
}
