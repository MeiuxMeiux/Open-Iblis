// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Stems documentation screenshots: the split flow and the stem mixer in each
// built-in skin, plus the Stems settings card.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openView, toneWav, useShell } from './harness'

const OUT = process.env.IBLIS_SHOTS_DIR ?? join(import.meta.dirname, '..', 'shots')
const session = useShell({ wavs: { 'Night Drive.wav': toneWav(8) }, stemProcessor: true })

async function shot(name: string): Promise<void> {
  await session.shell.win.waitForTimeout(400)
  await session.shell.win.screenshot({ path: join(OUT, `${name}.png`), fullPage: false })
}

async function skin(id: string): Promise<void> {
  await session.shell.win.evaluate(
    (value) => document.documentElement.setAttribute('data-skin', value),
    id
  )
}

it('captures the stems flow in every built-in skin', async () => {
  mkdirSync(OUT, { recursive: true })
  const { win } = session.shell
  await win.setViewportSize({ width: 1440, height: 900 })
  await openView(win, 'Library')
  await win.getByRole('button', { name: /^Show details for Imported/ }).click()
  const stems = win.getByRole('dialog').getByRole('region', { name: 'Stems' })
  await stems.scrollIntoViewIfNeeded()
  await expect.poll(() => stems.getByRole('button', { name: 'Split stems' }).count()).toBe(1)
  await shot('stems-empty')
  await stems.getByRole('button', { name: 'Split stems' }).click()
  await expect.poll(() => stems.getByRole('status').count()).toBeGreaterThan(0)
  await win.waitForTimeout(500)
  await shot('stems-progress')
  await expect
    .poll(() => stems.getByRole('slider', { name: 'Drums position' }).count(), { timeout: 20_000 })
    .toBe(1)
  await stems.getByRole('button', { name: 'Solo Vocals' }).click()
  await stems.getByRole('button', { name: 'Mute Bass' }).click()
  await stems.scrollIntoViewIfNeeded()
  for (const id of ['dark-3d', 'light-paper', 'infernal', 'cathedral']) {
    await skin(id)
    await shot(`stems-${id}`)
  }
  await skin('dark-3d')
  await win.keyboard.press('Escape')
  await openView(win, 'Settings')
  await win.getByRole('button', { name: /^Stems\b/ }).click()
  await shot('stems-settings')
})
