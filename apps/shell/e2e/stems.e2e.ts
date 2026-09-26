// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openView, toneWav, useShell } from './harness'

const session = useShell({ wavs: { 'e2e-stems.wav': toneWav(6) }, stemProcessor: true })

const stemAudio = (): Promise<{ count: number; playing: number; muted: number }> =>
  session.shell.win.evaluate(() => {
    // The mixer's <audio> elements are detached; count them through the
    // media the page created for iblis-stem:// sources.
    const all = (window as unknown as { __stemAudio?: HTMLAudioElement[] }).__stemAudio ?? []
    return {
      count: all.length,
      playing: all.filter((a) => !a.paused).length,
      muted: all.filter((a) => a.volume === 0).length
    }
  })

it('splits a track into stems, auditions them in sync, and deletes the set', async () => {
  const { win } = session.shell
  // Record every Audio the page constructs so the test can inspect the mixer.
  await win.evaluate(() => {
    const Native = window.Audio
    const seen: HTMLAudioElement[] = []
    ;(window as unknown as { __stemAudio: HTMLAudioElement[] }).__stemAudio = seen
    window.Audio = function (this: unknown, src?: string) {
      const audio = new Native(src)
      seen.push(audio)
      return audio
    } as unknown as typeof Audio
  })
  await openView(win, 'Library')
  await win.getByRole('button', { name: /^Show details for Imported/ }).click()
  const drawer = win.getByRole('dialog')
  const stems = drawer.getByRole('region', { name: 'Stems' })
  await stems.getByRole('button', { name: 'Split stems' }).click()

  await expect.poll(() => stems.getByRole('status').count()).toBeGreaterThan(0)
  await expect
    .poll(() => stems.getByRole('slider', { name: 'Drums position' }).count(), { timeout: 20_000 })
    .toBe(1)
  for (const name of ['Vocals', 'Drums', 'Bass', 'Other']) {
    expect(await stems.getByText(name, { exact: true }).count()).toBeGreaterThan(0)
  }
  expect(await stems.getByText(/BPM$/).count()).toBeGreaterThan(0)
  expect(await stems.getByText(/clean re-sum/).count()).toBe(1)

  const trackDir = readdirSync(session.env.tracks).find((n) => /^[0-9a-z]{26}$/.test(n)) ?? ''
  expect(trackDir).not.toBe('')
  const sets = readdirSync(join(session.env.tracks, trackDir, 'stems')).filter(
    (n) => !n.startsWith('.')
  )
  expect(sets).toHaveLength(1)
  expect(existsSync(join(session.env.tracks, trackDir, 'audio.wav'))).toBe(true)

  await expect.poll(() => stems.getByRole('button', { name: 'Play stems' }).isEnabled()).toBe(true)
  await stems.getByRole('button', { name: 'Play stems' }).click()
  await expect.poll(async () => (await stemAudio()).playing).toBe(4)
  await stems.getByRole('button', { name: 'Solo Drums' }).click()
  await expect.poll(async () => (await stemAudio()).muted).toBe(3)
  await stems.getByRole('button', { name: 'Pause stems' }).click()
  await expect.poll(async () => (await stemAudio()).playing).toBe(0)

  await stems.getByRole('button', { name: 'Delete stems' }).click()
  await stems.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(() => stems.getByRole('button', { name: 'Split stems' }).count()).toBe(1)
  expect(existsSync(join(session.env.tracks, trackDir, 'audio.wav'))).toBe(true)
  expect(session.shell.errors).toEqual([])
})
