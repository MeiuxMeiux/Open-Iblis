// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ICON_NAMES } from '../src/lib/ui/icons'

const shellRoot = resolve(__dirname, '..')
const repoRoot = resolve(shellRoot, '../..')
const read = (path: string): string => readFileSync(resolve(shellRoot, path), 'utf8')

function svelteFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name)
    if (entry.isDirectory()) return svelteFiles(full)
    return entry.name.endsWith('.svelte') ? [full] : []
  })
}

function controlUses(source: string, marker: string, icon: string): boolean {
  return [...source.matchAll(/<button\b[\s\S]*?<\/button>/g)].some(
    ([button]) => button.includes(marker) && button.includes(`name="${icon}"`)
  )
}

function expectControl(source: string, marker: string, icon: string): void {
  expect(controlUses(source, marker, icon)).toBe(true)
}

describe('shared icon system', () => {
  it('keeps the typed registry and shared sprite in exact lockstep', () => {
    const sprite = readFileSync(resolve(repoRoot, 'packages/brand/icons/sprite.svg'), 'utf8')
    const symbols = [...sprite.matchAll(/<symbol id="i-([^"]+)" viewBox="([^"]+)">/g)]
    const names = symbols.map((match) => match[1])

    expect(names).toEqual([...ICON_NAMES])
    expect(new Set(names).size).toBe(names.length)
    expect(symbols.every((match) => match[2] === '0 0 24 24')).toBe(true)

    const paints = [...sprite.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((match) => match[1])
    expect(paints.every((paint) => paint === 'currentColor' || paint === 'none')).toBe(true)
  })

  it('mounts one decorative sprite and keeps semantics on parent controls', () => {
    const app = read('src/App.svelte')
    const icon = read('src/lib/ui/Icon.svelte')
    const nav = read('src/lib/Nav.svelte')

    expect(app.match(/<IconSprite\b/g)).toHaveLength(1)
    expect(icon).toContain('aria-hidden="true"')
    expect(icon).toContain('focusable="false"')
    expect(icon).toContain('<use href={`#i-${name}`}')
    expect(nav.match(/<Icon\b/g)).toHaveLength(1)
    expect(nav).toContain('aria-current=')
    for (const label of ['Home', 'Create', 'Library', 'Plugins', 'Settings']) {
      expect(nav).toContain(`label: '${label}'`)
    }
  })

  it('routes action artwork through Icon while exempting brand and waveform SVGs', () => {
    const rawSvgFiles = svelteFiles(resolve(shellRoot, 'src/lib'))
      .filter((path) => readFileSync(path, 'utf8').includes('<svg'))
      .map((path) => basename(path))
      .sort()

    expect(rawSvgFiles).toEqual(['Icon.svelte', 'Sigil.svelte', 'Waveform.svelte'])
  })

  it('keeps dense Queue and Library artwork on named accessible controls', () => {
    const queuePanel = read('src/lib/queue/QueuePanel.svelte')
    const queueEdit = read('src/lib/queue/QueueEditForm.svelte')
    expectControl(queuePanel, '<span>Resume</span>', 'play')
    expectControl(queuePanel, '<span>Pause after current</span>', 'pause')
    expectControl(queuePanel, '<span>Stop current</span>', 'stop')
    expectControl(queuePanel, 'aria-label={`Move queued take ${index + 1} earlier`}', 'chevron-up')
    expectControl(queuePanel, 'aria-label={`Move queued take ${index + 1} later`}', 'chevron-down')
    expectControl(queuePanel, 'aria-label={`Edit queued take ${index + 1}`}', 'edit')
    expectControl(queuePanel, 'aria-label={`Duplicate queued take ${index + 1}`}', 'copy')
    expectControl(queuePanel, 'aria-label={`Remove queued take ${index + 1}`}', 'trash')
    expect(queuePanel).toContain('<span>Remove</span>')
    expect(queueEdit).toContain('promptInput?.focus()')
    expect(queuePanel).toContain('data-edit-id={entry.id}')
    expect(queuePanel).toContain("querySelectorAll<HTMLButtonElement>('button[data-edit-id]')")
    expect(queuePanel).toContain('disabled={!queue.paused || !!queue.pendingAction}')
    expect(queueEdit).toContain('step="any"')
    expect(queuePanel).toContain('<p class="queue-message warning" role="status">')
    expect(queuePanel).toContain('role="alert"')

    const history = read('src/lib/queue/QueueHistory.svelte')
    expect(history).toContain('<Icon name="history"')
    expectControl(history, 'aria-label={`Reveal finished A/B', 'eye')
    expect(history).toContain("? 'pause' : 'play'")
    expect(history).toContain('label={`Like ${queueTitle(entry, result.name)}`}')
    expect(history).toContain('<Icon name="thumb-up"')
    expect(history).toContain('label={`Dislike ${queueTitle(entry, result.name)}`}')
    expect(history).toContain('<Icon name="thumb-down"')

    const row = `${read('src/lib/library/TrackRow.svelte')}\n${read('src/lib/library/TrackActions.svelte')}`
    expect(row).not.toContain('<button class="name"')
    expect(row).toContain('<span class="name" ondblclick={startEdit}')
    expect(row).toContain('label={`Like ${track.name}`}')
    expect(row).toContain('label={`Dislike ${track.name}`}')
    expectControl(row, 'aria-label={`Rename ${track.name}`}', 'edit')
    expectControl(row, 'aria-label={`Remix ${track.name}`}', 'remix')
    expectControl(row, 'aria-label={`Show details for ${track.name}`}', 'info')
    expectControl(row, 'aria-label={`Show ${track.name} in its folder`}', 'folder')
    expectControl(row, 'aria-label={`Delete ${track.name}`}', 'trash')

    const detail = read('src/lib/library/TrackDetailDrawer.svelte')
    expectControl(detail, 'aria-label="Close track details"', 'close')
    expectControl(detail, '<span>Remix this recipe</span>', 'remix')
  })

  it('keeps Home truthful after an engine pack is installed', () => {
    const home = read('src/lib/views/Home.svelte')

    expect(home).toContain('window.iblis.engine.info()')
    expect(home).toContain('Ready to create.')
    expect(home).toContain('The engine is starting.')
    expect(home).toContain('Install the engine pack to get started.')
    expect(home).toContain('<Icon name="refresh"')
    expect(home).not.toContain('the first audio engine arrive in the next phases')
  })
})
