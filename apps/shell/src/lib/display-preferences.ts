// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { TRACK_SORT_ORDERS, type TrackSortOrder } from './library/track-sort'
import type { WaveformMode } from './player/waveform-geometry'

export type VolumeControlStyle = 'slider' | 'vertical' | 'knob'

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
export type PlaybackRate = (typeof PLAYBACK_RATES)[number]

export interface PlayerDisplayPreferences {
  showTargetMetadata: boolean
  showFormat: boolean
  showWaveform: boolean
  showPlaybackRate: boolean
  showVolume: boolean
  showQueueStatus: boolean
  waveformMode: WaveformMode
  volumeStyle: VolumeControlStyle
  playbackRate: PlaybackRate
}

export interface LibraryDisplayPreferences {
  showTargetMetadata: boolean
  showDetectedAnalysis: boolean
  showPreset: boolean
  showDate: boolean
  showSeed: boolean
  sortOrder: TrackSortOrder
}

interface DisplayPreferencesV1 {
  version: 1
  player: PlayerDisplayPreferences
  library: LibraryDisplayPreferences
}

export const DEFAULT_PLAYER_DISPLAY: Readonly<PlayerDisplayPreferences> = {
  showTargetMetadata: true,
  showFormat: true,
  showWaveform: true,
  showPlaybackRate: true,
  showVolume: true,
  showQueueStatus: true,
  waveformMode: 'peaks',
  volumeStyle: 'slider',
  playbackRate: 1
}

export const DEFAULT_LIBRARY_DISPLAY: Readonly<LibraryDisplayPreferences> = {
  showTargetMetadata: true,
  showDetectedAnalysis: true,
  showPreset: true,
  showDate: true,
  showSeed: false,
  sortOrder: 'newest'
}

const STORAGE_KEY = 'iblis.display.v1'
const WAVEFORM_MODES = new Set<WaveformMode>(['peaks', 'mirrored', 'timeline'])
const VOLUME_STYLES = new Set<VolumeControlStyle>(['slider', 'vertical', 'knob'])
const RATES = new Set<number>(PLAYBACK_RATES)

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const defaultStorage = (): StorageLike | undefined =>
  (globalThis as { localStorage?: StorageLike }).localStorage

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizePlayer(value: unknown): PlayerDisplayPreferences {
  const raw = record(value)
  const waveformMode = WAVEFORM_MODES.has(raw.waveformMode as WaveformMode)
    ? (raw.waveformMode as WaveformMode)
    : DEFAULT_PLAYER_DISPLAY.waveformMode
  const volumeStyle = VOLUME_STYLES.has(raw.volumeStyle as VolumeControlStyle)
    ? (raw.volumeStyle as VolumeControlStyle)
    : DEFAULT_PLAYER_DISPLAY.volumeStyle
  const playbackRate = RATES.has(raw.playbackRate as number)
    ? (raw.playbackRate as PlaybackRate)
    : DEFAULT_PLAYER_DISPLAY.playbackRate
  return {
    showTargetMetadata: flag(raw.showTargetMetadata, DEFAULT_PLAYER_DISPLAY.showTargetMetadata),
    showFormat: flag(raw.showFormat, DEFAULT_PLAYER_DISPLAY.showFormat),
    showWaveform: flag(raw.showWaveform, DEFAULT_PLAYER_DISPLAY.showWaveform),
    showPlaybackRate: flag(raw.showPlaybackRate, DEFAULT_PLAYER_DISPLAY.showPlaybackRate),
    showVolume: flag(raw.showVolume, DEFAULT_PLAYER_DISPLAY.showVolume),
    showQueueStatus: flag(raw.showQueueStatus, DEFAULT_PLAYER_DISPLAY.showQueueStatus),
    waveformMode,
    volumeStyle,
    playbackRate
  }
}

function sanitizeLibrary(value: unknown): LibraryDisplayPreferences {
  const raw = record(value)
  return {
    showTargetMetadata: flag(raw.showTargetMetadata, DEFAULT_LIBRARY_DISPLAY.showTargetMetadata),
    showDetectedAnalysis: flag(
      raw.showDetectedAnalysis,
      DEFAULT_LIBRARY_DISPLAY.showDetectedAnalysis
    ),
    showPreset: flag(raw.showPreset, DEFAULT_LIBRARY_DISPLAY.showPreset),
    showDate: flag(raw.showDate, DEFAULT_LIBRARY_DISPLAY.showDate),
    showSeed: flag(raw.showSeed, DEFAULT_LIBRARY_DISPLAY.showSeed),
    sortOrder: (TRACK_SORT_ORDERS as readonly string[]).includes(raw.sortOrder as string)
      ? (raw.sortOrder as TrackSortOrder)
      : DEFAULT_LIBRARY_DISPLAY.sortOrder
  }
}

export function readDisplayPreferences(storage = defaultStorage()): DisplayPreferencesV1 {
  try {
    const text = storage?.getItem(STORAGE_KEY)
    const parsed = text ? record(JSON.parse(text)) : {}
    return {
      version: 1,
      player: sanitizePlayer(parsed.player),
      library: sanitizeLibrary(parsed.library)
    }
  } catch {
    return {
      version: 1,
      player: { ...DEFAULT_PLAYER_DISPLAY },
      library: { ...DEFAULT_LIBRARY_DISPLAY }
    }
  }
}

function write(value: DisplayPreferencesV1, storage = defaultStorage()): void {
  try {
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        player: sanitizePlayer(value.player),
        library: sanitizeLibrary(value.library)
      })
    )
  } catch {
    // Display persistence is best-effort; defaults remain usable.
  }
}

export function writePlayerDisplayPreferences(
  player: PlayerDisplayPreferences,
  storage = defaultStorage()
): void {
  const current = readDisplayPreferences(storage)
  write({ ...current, player: sanitizePlayer(player) }, storage)
}

export function writeLibraryDisplayPreferences(
  library: LibraryDisplayPreferences,
  storage = defaultStorage()
): void {
  const current = readDisplayPreferences(storage)
  write({ ...current, library: sanitizeLibrary(library) }, storage)
}
