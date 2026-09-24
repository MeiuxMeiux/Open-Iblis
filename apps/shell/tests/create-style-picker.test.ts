// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_ACTIVE_STYLES, styleRegistryName } from '../shared/styles'

const src = (path: string): string => readFileSync(join(__dirname, '..', 'src', path), 'utf8')

describe('Create style picker', () => {
  it('ships with the proven single-adapter cap', () => {
    expect(MAX_ACTIVE_STYLES).toBe(1)
    const picker = src('lib/styles/StylePicker.svelte')
    expect(picker).toContain('MAX_ACTIVE_STYLES')
    expect(picker).toContain('loads ${MAX_ACTIVE_STYLES} style at a time')
    expect(src('lib/styles/StylePickerList.svelte')).toContain('Swaps out ')
  })

  it('sits beside the profile control in Create', () => {
    const row = src('lib/views/CreateOptionsRow.svelte')
    expect(src('lib/views/Generate.svelte')).toContain('<CreateOptionsRow')
    expect(row).toContain('<StylePicker')
    expect(row).toContain('liveAdapters={info?.runtime?.adapters ?? null}')
    // Styles render only for engines that declare adapter ingress.
    expect(row).toContain('{#if showStyles}')
  })

  it('keeps None one click away and selects library records only', () => {
    const picker = src('lib/styles/StylePicker.svelte')
    expect(src('lib/styles/StylePickerList.svelte')).toContain('onSelect(null)')
    expect(picker).toContain('window.iblis.adapters.list()')
    expect(picker).not.toContain('window.iblis.styles.download')
  })

  it('renders unloaded styles disabled with the honest restart reason', () => {
    const list = src('lib/styles/StylePickerList.svelte')
    expect(list).toContain('Restart the engine to load this style.')
    expect(src('lib/styles/StylePicker.svelte')).toContain('window.iblis.perf.restartEngine()')
    expect(list).toContain('disabled={!entry.loaded}')
  })

  it('degrades a remix with a missing style honestly, to None', () => {
    const picker = src('lib/styles/StylePicker.svelte')
    expect(picker).toContain('no longer in your library')
    expect(picker).toContain("steering.adapter = ''")
  })

  it('reuses TrainingsSection for the browse-more modal — one implementation', () => {
    const modal = src('lib/styles/StyleBrowseModal.svelte')
    expect(modal).toContain("import TrainingsSection from './TrainingsSection.svelte'")
    expect(modal).toContain('role="dialog"')
    expect(modal).toContain("event.key === 'Escape'")
    const picker = src('lib/styles/StylePicker.svelte')
    expect(picker).toContain('<StyleBrowseModal')
  })

  it('makes queued takes auditable: style name and scale in the row summary', () => {
    const presentation = src('lib/queue/presentation.ts')
    expect(presentation).toContain('entry.request.config?.adapter')
    expect(presentation).toContain('style ${entry.request.config.adapter}')
  })

  it('keeps picker and modal token-only (no hex colors)', () => {
    for (const path of [
      'lib/styles/StylePicker.svelte',
      'lib/styles/StylePickerList.svelte',
      'lib/styles/StyleBrowseModal.svelte'
    ]) {
      expect(src(path)).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })
})

describe('styleRegistryName', () => {
  it('slugs and hash-prefixes stably', () => {
    expect(styleRegistryName('My Style!', 'a'.repeat(64))).toBe('my-style-aaaaaaaa')
    expect(styleRegistryName('***', 'b'.repeat(64))).toBe('style-bbbbbbbb')
  })
})
