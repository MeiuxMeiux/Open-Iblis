// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

export interface PromptRecord {
  id: string
  text: string
  firstUsedAt: number
  lastUsedAt: number
  useCount: number
  starred: boolean
}

// Prompt dedup key per library.md: trim + lowercase first line.
function normalizePrompt(text: string): string {
  return (text.trim().split('\n')[0] ?? '').trim().toLowerCase()
}

export function recordPrompt(
  prompts: PromptRecord[],
  text: string,
  at: number,
  makeId: () => string
): PromptRecord {
  const key = normalizePrompt(text)
  let prompt = prompts.find((candidate) => normalizePrompt(candidate.text) === key)
  if (prompt) {
    prompt.lastUsedAt = at
    prompt.useCount += 1
    return prompt
  }
  prompt = {
    id: makeId(),
    text: text.trim(),
    firstUsedAt: at,
    lastUsedAt: at,
    useCount: 1,
    starred: false
  }
  prompts.push(prompt)
  return prompt
}

export function sortPrompts(prompts: PromptRecord[]): PromptRecord[] {
  return [...prompts].sort(
    (a, b) => Number(b.starred) - Number(a.starred) || b.lastUsedAt - a.lastUsedAt
  )
}

export function updatePromptStar(
  prompts: PromptRecord[],
  id: string,
  starred: boolean
): PromptRecord {
  const prompt = prompts.find((candidate) => candidate.id === id)
  if (!prompt) throw new Error(`unknown prompt ${id}`)
  prompt.starred = starred
  return prompt
}

export function deletePrompt(prompts: PromptRecord[], id: string): boolean {
  const index = prompts.findIndex((prompt) => prompt.id === id)
  if (index === -1) return false
  prompts.splice(index, 1)
  return true
}

export function clearUnstarredPrompts(prompts: PromptRecord[]): number {
  const kept = prompts.filter((prompt) => prompt.starred)
  const removed = prompts.length - kept.length
  if (removed > 0) prompts.splice(0, prompts.length, ...kept)
  return removed
}
