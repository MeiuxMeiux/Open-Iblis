// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Static, editable starting points for the first bass-music quality slice.
// Selecting one only replaces the two text fields; controls and profile stay
// under the user's control so a starter never hides a generation default.

export interface PromptStarter {
  id: string
  name: string
  prompt: string
  negativePrompt: string
}

const BASS_AVOID =
  'commercial pop, tropical house, big-room EDM, cheerful major-key hook, radio vocal chorus, generic supersaw'

export const PROMPT_STARTERS: readonly PromptStarter[] = [
  {
    id: 'neuro-dnb',
    name: 'Neuro DnB',
    prompt:
      'instrumental neurofunk drum and bass, 174 bpm, F minor, tense two-step drums, syncopated reese bass call and response, metallic FM snarls, sparse dystopian pads, eight-bar DJ intro, escalating pre-drop tension, brutal half-time switch, detailed fills and impact tails',
    negativePrompt: BASS_AVOID
  },
  {
    id: 'liquid-dnb',
    name: 'Liquid DnB',
    prompt:
      'instrumental liquid drum and bass, 174 bpm, D minor, rolling breakbeats, warm sub bass, jazzy Rhodes chords, airy atmosphere, restrained melodic motif, sixteen-bar intro, flowing breakdown, controlled lift into a rolling second drop',
    negativePrompt: BASS_AVOID
  },
  {
    id: 'dubstep-riddim',
    name: 'Dubstep / Riddim',
    prompt:
      'instrumental dubstep riddim, 140 bpm, F minor, half-time drums, square-wave bass growls, syncopated call-and-response bass rhythm, stop-start gaps, filtered intro, tense build, heavy drop, sparse second breakdown and final impact',
    negativePrompt: BASS_AVOID
  },
  {
    id: 'melodic-bass',
    name: 'Melodic Bass',
    prompt:
      'instrumental melodic bass, 150 bpm, A minor, emotive minor-key chord progression, wide textured saw layers, vocal-like lead without words, punchy future-bass drums, cinematic intro, tension build, melodic drop with bass movement, reflective outro',
    negativePrompt: BASS_AVOID
  },
  {
    id: 'halftime-neurohop',
    name: 'Halftime / Neurohop',
    prompt:
      'instrumental halftime neurohop, 85 bpm, E minor, swung hip-hop drums, deep reese bass, granular glitches, dub sirens, dark cinematic texture, spacious verse groove, syncopated bass drop, sparse break and final low-end hit',
    negativePrompt: BASS_AVOID
  },
  {
    id: 'drumstep',
    name: 'Drumstep',
    prompt:
      'instrumental drumstep, 174 bpm, G minor, alternating full-time drum and bass breaks with half-time drop, distorted reese bass, sharp snare impacts, aggressive fills, dark riser, double-time energy, compact arrangement and final stop',
    negativePrompt: BASS_AVOID
  }
]
