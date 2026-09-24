// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, it } from 'vitest'
import { axeViolations, openView, useShell } from './harness'

// Create against the canonical v2 fixture engine (packages/plugins/
// fixture-engine): a zero-dependency Node sidecar with deliberately un-ACE
// models, profiles and controls, so everything here reaches the form through
// the signed descriptor rather than any engine-specific branch.
const session = useShell({ plugins: ['fixture-engine'] })

it('enables Create once an engine pack is installed', async () => {
  const { win } = session.shell
  const create = win
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Create', exact: true })
  expect(await create.isDisabled()).toBe(false)
  await openView(win, 'Create')
  await expect.poll(() => win.locator('h1:visible').allInnerTexts()).toEqual(['Create'])
})

it('builds the form from the engine descriptor', async () => {
  const { win } = session.shell
  await expect.poll(() => win.getByText('Ready, starts on demand').count()).toBe(1)
  expect(await win.getByText('Models: pastiche-mini@r3, pastiche-grand@r1').count()).toBe(1)
  // A wrapping <label>'s name includes the embedded control's value, hence
  // the prefix matches.
  const profile = win.getByRole('combobox', { name: /^Profile/ })
  const profiles = await profile.locator('option').allInnerTexts()
  expect(profiles).toEqual(['Sketchbook — pastiche-mini@r3', 'Gallery — pastiche-grand@r1'])

  await win.locator('summary', { hasText: 'Advanced' }).click()
  // Descriptor controls: the common BPM plus the fixture's own three.
  const controls: [role: 'spinbutton' | 'combobox' | 'switch', name: RegExp][] = [
    ['spinbutton', /^BPM$/],
    ['combobox', /^Canvas/],
    ['spinbutton', /^Layers \(1 to 8\)/],
    ['switch', /^Crackle$/]
  ]
  for (const [role, name] of controls) {
    expect(await win.getByRole(role, { name }).count()).toBe(1)
  }
})

it('generates a take that lands in the Library', async () => {
  const { win } = session.shell
  const generate = win.getByRole('button', { name: 'Generate', exact: true })
  expect(await generate.isDisabled()).toBe(true)
  await win.getByRole('textbox', { name: 'Prompt' }).fill('a slow brass chorale')
  await win.getByLabel('Length (sec, 1 to 120)').fill('2')
  await generate.click()

  await expect.poll(() => win.getByText('1 recent result').count()).toBe(1)
  await expect.poll(() => win.getByText('Running', { exact: true }).count()).toBe(1)

  await openView(win, 'Library')
  const row = win
    .getByRole('list')
    .getByRole('listitem')
    .filter({ hasText: 'a slow brass chorale' })
  await expect.poll(() => row.count()).toBe(1)
  expect(await row.innerText()).toMatch(/0:02[\s\S]*sketchbook/)
})

it('has no axe violations on Create with an engine', async () => {
  const { win } = session.shell
  await openView(win, 'Create')
  expect(await axeViolations(win)).toEqual([])
})

it('stays on the fixture server and logs no renderer errors', () => {
  const allowed = [
    '/api/v2/catalog.json',
    '/api/v2/catalog.json.sig',
    '/trainings/index.json',
    '/trainings/index.json.sig'
  ]
  expect(session.fixture.requests.filter((path) => !allowed.includes(path))).toEqual([])
  expect(session.shell.errors).toEqual([])
})
