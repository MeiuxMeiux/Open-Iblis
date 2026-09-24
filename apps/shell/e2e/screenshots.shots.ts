// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Documentation screenshots of the real renderer (`just shell-screenshots`).
// Same disposable environment as the E2E suite: the fixture engine, a seeded
// WAV, and a fake 8 GB GPU, so every view has something to show and nothing
// touches the network or a developer's own install.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openView, toneWav, useShell } from './harness'

const OUT = process.env.IBLIS_SHOTS_DIR ?? join(import.meta.dirname, '..', 'shots')
const session = useShell({
  plugins: ['fixture-engine'],
  wavs: { 'Demo.wav': toneWav(6) },
  gpuVramMb: 8192,
  trainingPack: true
})

async function shot(name: string): Promise<void> {
  const { win } = session.shell
  // Let reveal transitions settle before the capture.
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(OUT, `${name}.png`), fullPage: false })
}

it('captures every primary view', async () => {
  mkdirSync(OUT, { recursive: true })
  const { win } = session.shell
  await win.setViewportSize({ width: 1440, height: 900 })

  await openView(win, 'Create')
  await expect.poll(() => win.getByText('Ready, starts on demand').count()).toBe(1)
  await win
    .getByRole('textbox', { name: 'Prompt' })
    .fill('slow brass chorale, warm hall, late evening')
  await win.getByLabel('Length (sec, 1 to 120)').fill('12')
  await win.locator('summary', { hasText: 'Advanced' }).click()
  await shot('create')

  await win.getByRole('button', { name: 'Generate', exact: true }).click()
  await expect.poll(() => win.getByText('1 recent result').count()).toBe(1)
  await openView(win, 'Library')
  const row = win.getByRole('list').getByRole('listitem').filter({ hasText: 'slow brass chorale' })
  await expect.poll(() => row.count()).toBe(1)
  await win
    .getByRole('list')
    .getByRole('button', { name: 'Play Imported Demo', exact: true })
    .click()
  await win.waitForTimeout(1500)
  await shot('library')

  await openView(win, 'Styles')
  await shot('styles')
  await openView(win, 'Training')
  await shot('training')
  await openView(win, 'Plugins')
  await shot('plugins')

  await openView(win, 'Settings')
  await shot('settings')
  await win.getByRole('button', { name: /^Appearance\b/ }).click()
  await win.waitForTimeout(300)
  await shot('appearance')
  const skins: [id: string, name: string][] = [
    ['light-paper', 'Light Paper'],
    ['infernal', 'Infernal'],
    ['cathedral', 'Cathedral']
  ]
  for (const [id, name] of skins) {
    await win.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click()
    await expect
      .poll(() => win.evaluate(() => document.documentElement.getAttribute('data-skin')))
      .toBe(id)
    await win
      .getByRole('navigation', { name: 'Settings section' })
      .getByRole('button', { name: 'All settings' })
      .click()
    await openView(win, 'Library')
    await shot(`library-${id}`)
    await openView(win, 'Settings')
    await win.getByRole('button', { name: /^Appearance\b/ }).click()
  }
  expect(session.shell.errors).toEqual([])
})
