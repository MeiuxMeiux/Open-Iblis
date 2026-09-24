// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

// SlotContract — the named extension points the shell exposes. Plugins
// register components or commands into slots; the shell composes them.
// Multiple plugins per slot are supported; the user reorders priority.

export const SLOT_IDS = [
  'library.toolbar',
  'library.sidebar',
  'track.row.right',
  'track.detail.tab',
  'waveform.viewer',
  'generate.advanced',
  'settings.section'
] as const

export type SlotId = (typeof SLOT_IDS)[number]

export type SlotAccepts = 'component' | 'command' | 'column'

export interface SlotDef {
  readonly id: SlotId
  readonly accepts: SlotAccepts
  readonly description: string
}

// The authoritative slot registry for v1.0.0. Keep in sync with
// docs/feature/plugins.md "SlotContract".
export const SLOTS: Readonly<Record<SlotId, SlotDef>> = {
  'library.toolbar': {
    id: 'library.toolbar',
    accepts: 'command',
    description: 'Buttons in the library top bar'
  },
  'library.sidebar': {
    id: 'library.sidebar',
    accepts: 'component',
    description: 'Folder tree, smart playlists, etc.'
  },
  'track.row.right': {
    id: 'track.row.right',
    accepts: 'component',
    description: 'Badges (BPM, key, plugin-added info)'
  },
  'track.detail.tab': {
    id: 'track.detail.tab',
    accepts: 'component',
    description: 'Extra tabs in the track detail view'
  },
  'waveform.viewer': {
    id: 'waveform.viewer',
    accepts: 'component',
    description: 'The waveform itself — pluggable'
  },
  'generate.advanced': {
    id: 'generate.advanced',
    accepts: 'component',
    description: 'Extra controls in the Advanced panel'
  },
  'settings.section': {
    id: 'settings.section',
    accepts: 'component',
    description: "A plugin's own settings page"
  }
} as const

export const isSlotId = (v: unknown): v is SlotId =>
  typeof v === 'string' && (SLOT_IDS as readonly string[]).includes(v)
