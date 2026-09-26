// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Pure text helpers for the assist dialog (no bridge, no state).
import type { AssistModelOption, AssistTask } from '../../../shared/text-assist'

// Insert never loses what the user already typed unless they chose Replace.
export function merged(
  task: AssistTask,
  current: string,
  text: string,
  mode: 'replace' | 'append'
): string {
  const existing = current.trim()
  if (mode === 'replace' || !existing) return text
  return task === 'song-ideas' ? `${existing}, ${text}` : `${existing}\n\n${text}`
}

export function priceLabel(model: AssistModelOption | null, usd: number | undefined): string {
  if (!model) return ''
  if (model.free) return 'Free model (as reported by OpenRouter)'
  if (usd === undefined) return 'Price not reported by OpenRouter'
  const shown = usd < 0.0001 ? 'under $0.0001' : `up to $${usd.toFixed(4)}`
  return `Estimated ${shown} for this request (OpenRouter-reported prices)`
}
