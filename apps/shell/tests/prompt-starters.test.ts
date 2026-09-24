// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { PROMPT_STARTERS } from '../src/lib/views/prompt-starters'

describe('bass prompt starters', () => {
  it('keeps the six documented starters editable and free of ambiguous clean avoidance', () => {
    expect(PROMPT_STARTERS).toHaveLength(6)
    expect(new Set(PROMPT_STARTERS.map((starter) => starter.id)).size).toBe(PROMPT_STARTERS.length)
    expect(new Set(PROMPT_STARTERS.map((starter) => starter.name)).size).toBe(
      PROMPT_STARTERS.length
    )

    for (const starter of PROMPT_STARTERS) {
      expect(starter.prompt).toMatch(/\bbpm\b/iu)
      expect(starter.negativePrompt).toContain('commercial pop')
      expect(starter.negativePrompt).not.toMatch(/\bclean\b/iu)
    }
  })
})
