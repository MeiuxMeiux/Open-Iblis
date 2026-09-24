// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { expect, it } from 'vitest'
import { openView, toneWav, useShell } from './harness'

const session = useShell({ wavs: { 'e2e-tone.wav': toneWav() } })

const audioState = (): Promise<{ paused: boolean; time: number }> =>
  session.shell.win.evaluate(() => {
    const audio = document.querySelector('audio')
    return { paused: audio?.paused ?? true, time: audio?.currentTime ?? 0 }
  })

it('imports a WAV from the tracks folder and plays it', async () => {
  const { win } = session.shell
  await openView(win, 'Library')
  await win
    .getByRole('list')
    .getByRole('button', { name: 'Play Imported e2e-tone', exact: true })
    .click()

  await expect.poll(async () => (await audioState()).time).toBeGreaterThan(0.3)
  expect((await audioState()).paused).toBe(false)
  const transport = win.getByRole('contentinfo', { name: 'Player' })
  expect(await transport.getByText('Imported e2e-tone').count()).toBeGreaterThan(0)

  await transport.getByRole('button', { name: 'Pause Imported e2e-tone', exact: true }).click()
  await expect.poll(async () => (await audioState()).paused).toBe(true)
  expect(session.shell.errors).toEqual([])
})
