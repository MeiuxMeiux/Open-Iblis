// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LibraryTrack } from '../shared/contract'
import type { QueueEntry } from '../shared/generation-queue'
import { comparisonForTrack } from '../src/lib/queue/comparison-visibility'

describe('blind comparison UI boundaries', () => {
  it('masks Library recipes and keeps blind playback/rating in queue history', async () => {
    const row = await readFile(join(__dirname, '../src/lib/library/TrackRow.svelte'), 'utf8')
    const actions = await readFile(
      join(__dirname, '../src/lib/library/TrackActions.svelte'),
      'utf8'
    )
    const history = await readFile(join(__dirname, '../src/lib/queue/QueueHistory.svelte'), 'utf8')
    const presentation = await readFile(join(__dirname, '../src/lib/queue/presentation.ts'), 'utf8')
    const engine = await readFile(
      join(__dirname, '../electron/main/engine/drivers/ace-compat/driver.ts'),
      'utf8'
    )
    const library = await readFile(join(__dirname, '../electron/main/library/index.ts'), 'utf8')

    expect(row).toContain('comparison && !comparison.revealed')
    expect(row).toContain('<TrackActions')
    expect(row).toContain('{recipeHidden}')
    const guardStart = actions.indexOf('{#if !recipeHidden}')
    const guardedActions = actions.slice(guardStart, actions.indexOf('{/if}', guardStart))
    expect(guardedActions).toContain('if (!busy) onremix()')
    expect(guardedActions).toContain('if (!busy) ondetail()')
    expect(guardedActions).toContain('if (!busy) onreveal()')
    expect(guardedActions).toContain('onclick={onremove}')
    expect(guardedActions).toContain('disabled={busy}')
    expect(presentation).toContain("return 'Controlled variant hidden'")
    expect(history).toContain('player.toggle(result)')
    expect(history).toContain('library.rate(result.id, 1)')
    expect(history).toContain('library.rate(result.id, -1)')
    expect(history.match(/<ToggleBadge/g)).toHaveLength(2)
    expect(history).toContain('const refreshAttempts = new Map<string, number>()')
    expect(history).toContain('(refreshAttempts.get(id) ?? 0) < 2')
    expect(history).not.toContain('trackIds.some((id) => !library.tracks')
    expect(engine).toContain('addGeneratedTrack(bytes, req, metadata, engineIdentity, jobId)')
    expect(library).toContain('{ generationJobId }')
  })

  it('matches the finishing Library row before result.trackId is available', () => {
    const config = {
      steps: 8,
      guidance: 1,
      shift: 3,
      solver: 'euler' as const,
      temperature: 0.85,
      rewritePrompt: true,
      autoLyrics: false,
      lmModel: 'lm.gguf',
      synthModel: 'turbo.gguf',
      adapterScale: 1,
      lmSeed: 2
    }
    const track: LibraryTrack = {
      id: 'track-before-result',
      name: 'Candidate',
      prompt: 'same prompt',
      createdAt: 1,
      rating: 0,
      format: 'wav',
      tags: [],
      requestedDurationSec: 30,
      preset: 'turbo-validated',
      seed: 1,
      config
    }
    const entry: QueueEntry = {
      id: 'candidate-a',
      request: {
        prompt: track.prompt,
        durationSec: 30,
        preset: track.preset!,
        seed: track.seed,
        config
      },
      status: 'running',
      createdAt: 1,
      updatedAt: 2,
      startedAt: 1,
      comparison: { groupId: 'group', blindLabel: 'A', revealed: false }
    }

    expect(comparisonForTrack(track, [entry])).toEqual(entry.comparison)
    expect(comparisonForTrack({ ...track, createdAt: 0 }, [entry])).toBeUndefined()

    const terminalWithoutResult: QueueEntry = {
      ...entry,
      status: 'failed',
      jobId: 'durable-host-job',
      finishedAt: 3,
      error: { code: 'evidence_failed', message: 'provenance write failed' }
    }
    expect(
      comparisonForTrack({ ...track, createdAt: 0, generationJobId: 'durable-host-job' }, [
        terminalWithoutResult
      ])
    ).toEqual(entry.comparison)
    expect(
      comparisonForTrack({ ...track, createdAt: 0, generationJobId: 'different-host-job' }, [
        terminalWithoutResult
      ])
    ).toBeUndefined()
  })
})
