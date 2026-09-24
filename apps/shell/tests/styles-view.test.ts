// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (path: string): string => readFileSync(join(__dirname, '..', 'src', path), 'utf8')

const STYLES_FILES = [
  'lib/views/Styles.svelte',
  'lib/styles/StylesView.svelte',
  'lib/styles/TrainingsSection.svelte',
  'lib/styles/CatalogSection.svelte',
  'lib/styles/LocalImportSection.svelte',
  'lib/styles/LibrarySection.svelte',
  'lib/styles/StyleCard.svelte',
  'lib/styles/StyleOfferCard.svelte',
  'lib/styles/StyleDisclosureDialog.svelte',
  'lib/styles/filters.ts'
]

describe('Styles nav section', () => {
  it('registers styles in the View union and nav items between library and training', () => {
    const nav = src('lib/Nav.svelte')
    expect(nav).toContain("'styles'")
    expect(nav).toContain("{ id: 'styles', label: 'Styles', icon: 'grid' }")
    const libraryAt = nav.indexOf("{ id: 'library'")
    const stylesAt = nav.indexOf("{ id: 'styles'")
    const trainingAt = nav.indexOf("{ id: 'training'")
    expect(libraryAt).toBeGreaterThanOrEqual(0)
    expect(stylesAt).toBeGreaterThan(libraryAt)
    expect(trainingAt).toBeGreaterThan(stylesAt)
  })

  it('keeps the Styles view mounted after its first visit in App', () => {
    const app = src('App.svelte')
    expect(app).toContain("import Styles from './lib/views/Styles.svelte'")
    expect(app).toContain("visited.has('styles')")
    expect(app).toContain("hidden={view !== 'styles'}")
  })

  it('no longer mounts the retired AdapterLibrary inside Plugins', () => {
    const plugins = src('lib/views/Plugins.svelte')
    expect(plugins).not.toContain('AdapterLibrary')
    expect(plugins).not.toContain('lib/adapters')
  })
})

describe('Community trainings section', () => {
  it('loads the verified index over IPC and refreshes with force', () => {
    const section = src('lib/styles/TrainingsSection.svelte')
    expect(section).toContain('window.iblis.styles.index(force)')
    expect(section).toContain('void load(true)')
    expect(section).toContain('Community trainings')
  })

  it('wires managed downloads with streamed progress and remove', () => {
    const section = src('lib/styles/TrainingsSection.svelte')
    expect(section).toContain('window.iblis.styles.download(entry.id)')
    expect(section).toContain('window.iblis.styles.onDownloadProgress')
    expect(section).toContain('window.iblis.styles.remove(adapterId)')
    expect(section).toContain('entry.installedAdapterId')
  })

  it('marks the trainings this install authored with an accent Yours badge', () => {
    const section = src('lib/styles/TrainingsSection.svelte')
    expect(section).toContain('{#if entry.yours}')
    expect(section).toContain('<Badge tone="accent" variant="outline">Yours</Badge>')
  })

  it('keeps local features sovereign with calm copy when the index is unreachable', () => {
    const section = src('lib/styles/TrainingsSection.svelte')
    expect(section).toContain(
      'The community library is unreachable. Downloaded and imported styles keep working.'
    )
  })

  it('designs its empty states instead of leaving blanks', () => {
    const section = src('lib/styles/TrainingsSection.svelte')
    expect(section).toContain('No community trainings match — clear filters.')
    expect(section).toContain('Nothing here yet. Train something and it will appear for everyone.')
  })
})

describe('Curated catalog section keeps the legal surface', () => {
  it('retains the disclosure dialog, risk switch, and stalled-read guard', () => {
    const catalog = src('lib/styles/CatalogSection.svelte')
    const card = src('lib/styles/StyleOfferCard.svelte')
    expect(catalog).toContain('<StyleDisclosureDialog')
    expect(catalog).toContain('timeLimit(window.iblis.adapters.list(), 5_000)')
    expect(catalog).toContain('window.iblis.adapters.installOffer(offer.id, true)')
    expect(catalog).toContain('requiresRiskAcknowledgement')
    expect(card).toContain('<ToggleSwitch')
    expect(card).toContain('I understand the risks')
    expect(card).toContain('Source and terms')
    expect(card).toContain("offer.lane === 'experimental'")
  })

  it('routes the local import through the same disclosure flow', () => {
    const local = src('lib/styles/LocalImportSection.svelte')
    expect(local).toContain('<StyleDisclosureDialog')
    expect(local).toContain('window.iblis.adapters.importFromDialog(')
    expect(local).toContain('I understand the risks')
  })
})

describe('My library section', () => {
  it('shows origin badges, disk usage, and reveal/remove actions', () => {
    const library = src('lib/styles/LibrarySection.svelte')
    expect(library).toContain("'Trained by you'")
    expect(library).toContain("'Downloaded'")
    expect(library).toContain("'Imported'")
    expect(library).toContain('window.iblis.adapters.reveal(id)')
    expect(library).toContain('window.iblis.adapters.remove(id)')
    expect(library).toContain('Total on disk')
  })
})

describe('Styles section styling', () => {
  it('keeps every styles file token-only (no hex colors)', () => {
    for (const path of STYLES_FILES) {
      expect(src(path), path).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })

  it('shares one presentational card primitive across trainings and library', () => {
    expect(src('lib/styles/TrainingsSection.svelte')).toContain('<StyleCard')
    expect(src('lib/styles/LibrarySection.svelte')).toContain('<StyleCard')
  })
})
