// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

function svelteSources(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(path, entry.name)
    if (entry.isDirectory()) return svelteSources(full)
    return entry.name.endsWith('.svelte') ? [readFileSync(full, 'utf8')] : []
  })
}

describe('shell control semantics', () => {
  it('implements the binary setting as a real switch without native checkboxes', () => {
    const toggle = read('src/lib/ui/ToggleSwitch.svelte')
    expect(toggle).toContain('type="button"')
    expect(toggle).toContain('role="switch"')
    expect(toggle).toContain('aria-checked={checked}')
    expect(toggle).toContain('{disabled}')
    expect(svelteSources(resolve(root, 'src')).join('\n')).not.toMatch(/type=["']checkbox["']/)
  })

  it('renders the style catalogue independently of a stalled local library read', () => {
    const catalog = read('src/lib/styles/CatalogSection.svelte')
    const card = read('src/lib/styles/StyleOfferCard.svelte')
    const disclosure = read('src/lib/styles/StyleDisclosureDialog.svelte')

    expect(catalog).toContain('const offerResult = await window.iblis.adapters.offers()')
    expect(catalog).toContain('offers = [...offerResult.data].sort')
    expect(catalog).toContain('timeLimit(window.iblis.adapters.list(), 5_000)')
    expect(catalog).not.toContain('Promise.all([')
    expect(card).toContain('Add to library')
    expect(card).toContain('<ToggleSwitch')
    expect(card).toContain('I understand the risks')
    expect(disclosure).toContain('role="dialog"')
    expect(disclosure).toContain('I understand the limits')
  })

  it('gives dense toggle actions stable pressed semantics', () => {
    const toggle = read('src/lib/ui/ToggleBadge.svelte')
    expect(toggle).toContain('type="button"')
    expect(toggle).toContain('aria-pressed={pressed}')
    expect(toggle).toContain('aria-label={label}')

    const trackRow = read('src/lib/library/TrackRow.svelte')
    const trackActions = read('src/lib/library/TrackActions.svelte')
    const trackControls = `${trackRow}\n${trackActions}`
    expect(trackActions.match(/<ToggleBadge/g)).toHaveLength(2)
    expect(trackActions).toContain('pressed={track.rating === 1}')
    expect(trackActions).toContain('pressed={track.rating === -1}')
    expect(trackControls.match(/aria-label=\{`Rename \$\{track\.name\}`\}/g)).toHaveLength(2)
    expect(trackActions).toContain('bind:this={renameAction}')
    expect(trackActions).toContain('disabled={editing || savingRename || busy}')
    expect(trackRow).toContain('restoreRenameFocus(source)')
    expect(trackActions).toContain('bind:this={deleteAction}')
    expect(trackRow).toContain('if (busy) return')
    expect(trackRow).toContain("if (savingRename && (e.key === 'Enter' || e.key === 'Escape'))")
    expect(read('src/lib/library/track-row.css')).toContain('.rename:focus-visible')
    const queueHistory = read('src/lib/queue/QueueHistory.svelte')
    expect(queueHistory.match(/<ToggleBadge/g)).toHaveLength(2)
    expect(queueHistory).toContain('pressed={result.rating === 1}')
    expect(queueHistory).toContain('pressed={result.rating === -1}')
    expect(read('src/lib/views/PromptHistory.svelte')).toContain('pressed={p.starred}')
  })

  it('keeps read-only badges noninteractive and shared across shell views', () => {
    const badge = read('src/lib/ui/Badge.svelte')
    expect(badge).toContain('<span')
    expect(badge).not.toContain('<button')

    for (const path of [
      'src/lib/library/TrackRow.svelte',
      'src/lib/plugins/PluginCard.svelte',
      'src/lib/skins/SkinEditor.svelte',
      'src/lib/views/AppearancePanel.svelte'
    ]) {
      expect(read(path), path).toContain('<Badge')
    }
  })

  it('keeps one persistent Library host and isolates probe playback', () => {
    const sources = svelteSources(resolve(root, 'src')).join('\n')
    const app = read('src/App.svelte')
    const host = read('src/lib/player/PlayerHost.svelte')
    const probe = read('src/lib/views/ProbeAudioPlayer.svelte')
    const trackRow = read('src/lib/library/TrackRow.svelte')

    expect(sources.match(/<audio\b/g)).toHaveLength(2)
    expect(host.match(/<audio\b/g)).toHaveLength(1)
    expect(probe.match(/<audio\b/g)).toHaveLength(1)
    expect(host).toContain('<audio')
    expect(host).toContain('preload="auto"')
    expect(host).toContain('audio.preservesPitch = true')
    expect(host).toContain('<PlayerTransport')
    expect(trackRow).not.toContain('<audio')

    expect(app.match(/<PlayerHost\b/g)).toHaveLength(1)
    expect(app.indexOf('<PlayerHost')).toBeGreaterThan(app.indexOf('</main>'))

    // Neither the media element nor the transport mount may depend on player state.
    const markup = host.slice(
      host.indexOf('</script>') + '</script>'.length,
      host.indexOf('<style>')
    )
    const firstConditional = markup.indexOf('{#if')
    expect(markup.indexOf('<audio')).toBeGreaterThanOrEqual(0)
    if (firstConditional !== -1) expect(markup.indexOf('<audio')).toBeLessThan(firstConditional)

    const waveform = read('src/lib/player/Waveform.svelte')
    expect(waveform).toContain('type="range"')
    expect(waveform).toContain('step="any"')
    expect(waveform).toContain('oninput={(event) => onpreview')
    expect(waveform).toContain('onchange={(event) => oncommit')
    expect(waveform).toContain('<defs>')
    expect(waveform.match(/<use/g)).toHaveLength(2)
    expect(waveform).toContain('<clipPath')
    expect(waveform).toMatch(
      /<div class="rail"[^>]*aria-hidden="true">[\s\S]*<\/div>\s*\{#if analysisLabel\}<span class="analysis-status" role="status">/
    )
    for (const token of ['--wave-bg', '--wave-peak', '--wave-fg', '--wave-playhead']) {
      expect(waveform).toContain(token)
    }

    const libraryStore = read('src/lib/library.svelte.ts')
    expect(libraryStore.indexOf('player.unloadIfActive(id)')).toBeLessThan(
      libraryStore.indexOf('await window.iblis.library.remove(id)')
    )
  })

  it('keeps global browsing, rate, waveform, and volume variants skin-aware', () => {
    const transport = read('src/lib/player/PlayerTransport.svelte')
    const options = read('src/lib/player/PlayerOptions.svelte')
    const volume = read('src/lib/player/VolumeControl.svelte')
    const preferences = read('src/lib/display-preferences.ts')

    expect(transport).toContain('onclick={() => player.previous()}')
    expect(transport).toContain('onclick={() => player.next()}')
    expect(transport).toContain('bind:value={display.playbackRate}')
    expect(transport).toContain('mode={display.waveformMode}')
    expect(transport).toContain('Generation target, not detected tempo')
    expect(transport).toContain('void library.refresh()')
    expect(options).toContain('<option value="peaks">')
    expect(options).toContain('<option value="mirrored">')
    expect(options).toContain('<option value="timeline">')
    expect(options).toContain('<option value="vertical">')
    expect(options).toContain('<option value="knob">')
    expect(volume).toContain('type="range"')
    expect(volume).toContain('var(--color-accent)')
    expect(volume).not.toMatch(/#[0-9a-f]{3,8}/iu)
    expect(preferences).toContain('showSeed: false')
  })
})
