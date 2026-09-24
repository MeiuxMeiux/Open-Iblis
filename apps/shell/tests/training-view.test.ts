// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (path: string): string => readFileSync(join(__dirname, '..', 'src', path), 'utf8')

describe('Training nav section', () => {
  it('registers training in the View union and nav items', () => {
    const nav = src('lib/Nav.svelte')
    expect(nav).toContain("'training'")
    expect(nav).toContain("{ id: 'training', label: 'Training', icon: 'book' }")
  })

  it('keeps the Training view mounted after its first visit in App', () => {
    const app = src('App.svelte')
    expect(app).toContain("import Training from './lib/views/Training.svelte'")
    expect(app).toContain("visited.has('training')")
    expect(app).toContain("hidden={view !== 'training'}")
  })
})

describe('Training view skeleton', () => {
  it('reads pack state over IPC and gates on it', () => {
    const view = src('lib/views/Training.svelte')
    expect(view).toContain('window.iblis.training.packState()')
    expect(view).toContain('<PackGate')
    expect(view).toContain('<PreflightChecklist')
  })

  it('mirrors the lock copy when a training runs', () => {
    const view = src('lib/views/Training.svelte')
    expect(view).toContain('TRAINING_LOCKS_GENERATION')
    expect(view).toContain('<LockBanner')
    expect(src('lib/ui/LockBanner.svelte')).toContain('role="status"')
  })

  it('offers the pack install through the ordinary catalog path, never a dead tab', () => {
    const gate = src('lib/training/PackGate.svelte')
    expect(gate).toContain('window.iblis.catalog.list()')
    expect(gate).toContain('window.iblis.plugins.install(TRAINING_PACK_ID, available.version)')
    expect(gate).toContain('Training needs the training pack')
    expect(gate).toContain('not in the catalog yet')
  })

  it('renders preflight rows from main with pass/warn/fail badges', () => {
    const checklist = src('lib/training/PreflightChecklist.svelte')
    expect(checklist).toContain('window.iblis.training.preflight()')
    expect(checklist).toContain("pass: 'success'")
    expect(checklist).toContain("warn: 'warning'")
    expect(checklist).toContain("fail: 'danger'")
  })

  it('keeps training components token-only (no hex colors)', () => {
    for (const path of [
      'lib/views/Training.svelte',
      'lib/training/PackGate.svelte',
      'lib/training/PreflightChecklist.svelte'
    ]) {
      expect(src(path)).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })
})

describe('Training wizard', () => {
  it('keeps the five steps in order and blocks each on its gate', () => {
    const wizard = src('lib/training/TrainingWizard.svelte')
    const nameStep = src('lib/training/NameStep.svelte')
    expect(wizard).toMatch(
      /'Songs',\s*'Readiness',\s*'Name',\s*privateTraining \? 'Rights' : 'Sharing',\s*'Start'/
    )
    expect(wizard).toContain('window.iblis.training.scanFolder()')
    expect(nameStep).toContain(
      'window.iblis.training.reserveName(name.trim(), $state.snapshot(categories))'
    )
    expect(wizard).toContain('disabled={!scan.preflight.ok}')
    expect(nameStep).toContain('disabled={!reserve?.available}')
    expect(wizard).toContain('disabled={!consented}')
    // A private training (no community key) needs only the rights attestation.
    expect(wizard).toContain('rights && (privateTraining || publicUpload)')
  })

  it('has a dedicated consent screen with both explicit acknowledgements', () => {
    const consent = src('lib/training/ConsentStep.svelte')
    expect(consent).toContain('community library')
    expect(consent).toContain('it is not an option')
    expect(consent).toContain('I understand my finished training uploads publicly')
    expect(consent).toContain('I hold the rights to every song in this folder')
    expect(consent.match(/<ToggleSwitch/g)?.length).toBe(2)
  })

  it('renders per-stage progress bars, not one monolithic bar', () => {
    const progress = src('lib/training/JobProgress.svelte')
    expect(progress).toContain('{#each job.stages as stage (stage.name)}')
    expect(progress).toContain('role="progressbar"')
    expect(progress).toContain('Cancel training')
  })

  it('history rows expose status chips and resume/delete actions', () => {
    const history = src('lib/training/JobHistory.svelte')
    expect(history).toContain("'awaiting-upload'")
    expect(history).toContain('Resume')
    expect(history).toContain('training.deleteJob(job.id)')
  })

  it('keeps every wizard component token-only (no hex colors)', () => {
    for (const path of [
      'lib/training/TrainingWizard.svelte',
      'lib/training/NameStep.svelte',
      'lib/training/ConsentStep.svelte',
      'lib/training/JobProgress.svelte',
      'lib/training/JobHistory.svelte'
    ]) {
      expect(src(path)).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })
})

describe('Create under the resource lock', () => {
  it('shows a non-dismissible banner and blocks generate while training', () => {
    const generate = src('lib/views/Generate.svelte')
    expect(generate).toContain('resource.training')
    expect(generate).toContain('<LockBanner text={resource.detail} />')
    expect(generate).toContain('&& !resource.training')
  })

  it('subscribes to the shared resource state store', () => {
    const store = src('lib/resource.svelte.ts')
    expect(store).toContain('window.iblis.resource.onState')
    expect(store).toContain('window.iblis.resource.state()')
  })
})
