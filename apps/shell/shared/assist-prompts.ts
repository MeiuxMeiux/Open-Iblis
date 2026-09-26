// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Prompt templates and output cleanup for the Create text helpers, kept in one
// small pure module so wording can be tuned without touching request code.
// Main builds requests from these; the renderer uses the same builders only
// to size an OpenRouter estimate, so the estimate matches what is sent.
import type { AssistModelOption, AssistRequest, AssistTask } from './text-assist'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

// Section tags ACE-Step reads in the lyrics field.
export const LYRICS_STRUCTURES = {
  short: { label: 'Short (verse, chorus)', tags: ['verse', 'chorus', 'verse', 'chorus'] },
  standard: {
    label: 'Standard (verse, chorus, bridge)',
    tags: ['verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus']
  },
  full: {
    label: 'Full (intro to outro)',
    tags: [
      'intro',
      'verse',
      'pre-chorus',
      'chorus',
      'verse',
      'pre-chorus',
      'chorus',
      'bridge',
      'chorus',
      'outro'
    ]
  }
} as const
export type LyricsStructure = keyof typeof LYRICS_STRUCTURES

export const BRIEF_LIMITS = { topic: 400, mood: 80, language: 40, seed: 300 } as const
export const MAX_TOKENS: Record<AssistTask, number> = {
  'lyrics-assistance': 1200,
  'song-ideas': 200
}
const MAX_OUTPUT: Record<AssistTask, number> = { 'lyrics-assistance': 4000, 'song-ideas': 400 }

// Tabs become spaces; other C0/C1 controls, bidi overrides and zero-width
// characters are removed. Newlines survive only where a caller keeps them.
const CONTROL = new RegExp(
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  '[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u200B-\\u200D\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g'
)

export function cleanField(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').replace(CONTROL, '').trim().slice(0, max)
}

export function isLyricsStructure(value: string): value is LyricsStructure {
  return Object.hasOwn(LYRICS_STRUCTURES, value)
}

function lyricsMessages(
  request: Extract<AssistRequest, { task: 'lyrics-assistance' }>
): ChatMessage[] {
  const brief = request.brief
  const structure = isLyricsStructure(brief.structure) ? brief.structure : 'standard'
  const tags = LYRICS_STRUCTURES[structure].tags.map((tag) => `[${tag}]`).join(', ')
  const language = brief.language || 'English'
  return [
    {
      role: 'system',
      content:
        'You write song lyrics for a music generator. Reply with the lyrics only: no title, ' +
        'no commentary, no markdown, no code fences. Start every section with its tag alone on ' +
        'a line, using only these tags: [intro], [verse], [pre-chorus], [chorus], [bridge], ' +
        '[outro]. Keep lines short, rhythmic and singable, four to eight lines per section. ' +
        `Write the lyrics in ${language}.`
    },
    {
      role: 'user',
      content: [
        `Topic: ${brief.topic}`,
        brief.mood ? `Mood: ${brief.mood}` : '',
        `Sections, in order: ${tags}`
      ]
        .filter(Boolean)
        .join('\n')
    }
  ]
}

function ideaMessages(request: Extract<AssistRequest, { task: 'song-ideas' }>): ChatMessage[] {
  const seed = request.brief.seed
  return [
    {
      role: 'system',
      content:
        'You suggest a style prompt for a music generator. Reply with exactly one line of 6 to ' +
        '14 comma-separated lowercase descriptors: genre, subgenre, key instruments, tempo in ' +
        'bpm, mood, vocal type or instrumental, production character. No sentences, no ' +
        'explanation, no quotes, no numbering.'
    },
    {
      role: 'user',
      content: seed ? `Starting point: ${seed}` : 'Suggest something fresh and specific.'
    }
  ]
}

export function assistMessages(request: AssistRequest): ChatMessage[] {
  return request.task === 'lyrics-assistance' ? lyricsMessages(request) : ideaMessages(request)
}

// Reasoning models served locally often prepend a think block; drop it, any
// code fences, and control characters, then bound the result. Lyrics keep
// their line structure; an idea collapses to one line.
export function cleanOutput(task: AssistTask, raw: string): { text: string; truncated: boolean } {
  let text = raw
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '')
    .replace(/^\s*```[^\n]*$/gm, '')
  if (task === 'song-ideas') {
    text = text
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim()
  } else {
    text = text
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  const max = MAX_OUTPUT[task]
  if (text.length <= max) return { text, truncated: false }
  const cut = text.slice(0, max)
  const boundary = task === 'lyrics-assistance' ? cut.lastIndexOf('\n') : cut.lastIndexOf(',')
  return { text: (boundary > max / 2 ? cut.slice(0, boundary) : cut).trimEnd(), truncated: true }
}

// An upper bound in USD from the provider-reported prices: the prompt at about
// four characters per token plus the full output allowance.
export function estimateUsd(model: AssistModelOption, request: AssistRequest): number | undefined {
  if (model.inputPerMillion === undefined && model.outputPerMillion === undefined) return undefined
  const chars = assistMessages(request).reduce((sum, message) => sum + message.content.length, 0)
  const input = Math.ceil(chars / 4) + 16
  const output = MAX_TOKENS[request.task]
  return (input * (model.inputPerMillion ?? 0) + output * (model.outputPerMillion ?? 0)) / 1_000_000
}
