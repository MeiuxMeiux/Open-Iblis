// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, it } from 'vitest'
import { axeViolations, openView, useShell } from './harness'

// Views reachable on a fresh install (no engine or training pack), with the
// h1 each one shows.
const VIEWS: [label: string, heading: string][] = [
  ['Home', 'The shell is awake.'],
  ['Library', 'Library'],
  ['Styles', 'Styles'],
  ['Plugins', 'Plugins'],
  ['Settings', 'Settings']
]

const session = useShell()

it('renders every available view', async () => {
  const { win } = session.shell
  for (const [label, heading] of VIEWS) {
    await openView(win, label)
    await expect.poll(() => win.locator('h1:visible').allInnerTexts()).toEqual([heading])
  }
})

it('disables Create and Training until their packs are installed', async () => {
  const nav = session.shell.win.getByRole('navigation', { name: 'Primary' })
  const create = nav.getByRole('button', { name: 'Create', exact: true })
  const training = nav.getByRole('button', { name: 'Training', exact: true })
  expect(await create.isDisabled()).toBe(true)
  expect(await create.getAttribute('title')).toBe('Install an engine pack from Plugins first')
  expect(await training.isDisabled()).toBe(true)
  expect(await training.getAttribute('title')).toBe('Install the training pack from Plugins first')
})

it('has no axe violations in any view', async () => {
  const { win } = session.shell
  const found: Record<string, unknown> = {}
  for (const [label] of VIEWS) {
    await openView(win, label)
    const violations = await axeViolations(win)
    if (violations.length > 0) found[label] = violations
  }
  expect(found).toEqual({})
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
