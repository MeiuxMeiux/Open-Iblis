// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, it } from 'vitest'
import { openView, useShell } from './harness'

const session = useShell()

it('lists the signed catalog served by the fixture', async () => {
  const { win } = session.shell
  await openView(win, 'Plugins')
  for (const name of ['Echo Server', 'ACE-Step 1.5', 'Fixture Engine', 'Boodark — Nord']) {
    await expect.poll(() => win.getByText(name, { exact: true }).count()).toBeGreaterThan(0)
  }
  expect(session.fixture.requests).toContain('/api/v2/catalog.json.sig')
  // A reformatted fixture fails here: the shell rejects bytes the key did not sign.
  expect(await win.locator('.error').allInnerTexts()).toEqual([])
})

it('shows the built-in analysis providers under the Audio analysis filter', async () => {
  const { win } = session.shell
  await win.getByRole('button', { name: 'Audio analysis', exact: true }).click()
  await expect
    .poll(() => win.getByRole('heading', { level: 2 }).allInnerTexts())
    .toEqual(expect.arrayContaining(['Iblis DSP', 'MusicTempo']))
  expect(await win.getByText('Fixture Engine', { exact: true }).count()).toBe(0)
  expect(session.shell.errors).toEqual([])
})
