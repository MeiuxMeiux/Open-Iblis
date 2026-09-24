// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  createShellEnv,
  launchShell,
  openView,
  startFixtureServer,
  type FixtureServer,
  type ShellEnv
} from './harness'

let fixture: FixtureServer
let env: ShellEnv

beforeAll(async () => {
  fixture = await startFixtureServer()
  env = createShellEnv()
})

afterAll(async () => {
  await fixture.close()
  env.dispose()
})

it('opens each settings card and returns to the hub', async () => {
  const shell = await launchShell(env, fixture)
  const { win } = shell
  await openView(win, 'Settings')
  const cards = ['Appearance', 'Engine', 'Audio analysis', 'Cloud providers', 'Data location']
  for (const title of [...cards, 'Diagnostics', 'Feedback', 'Updates']) {
    await win.getByRole('button', { name: new RegExp(`^${title}\\b`) }).click()
    const crumb = win.getByRole('navigation', { name: 'Settings section' })
    await expect.poll(() => crumb.innerText()).toContain(title)
    await crumb.getByRole('button', { name: 'All settings' }).click()
  }
  expect(shell.errors).toEqual([])
  await shell.close()
})

it('labels a source build and offers feedback forms without a diagnostics ref', async () => {
  const shell = await launchShell(env, fixture)
  const { win } = shell
  await openView(win, 'Settings')
  await win.getByRole('button', { name: /^Updates\b/ }).click()
  // The E2E bundle is built without IBLIS_OFFICIAL_BUILD: a source build that
  // must not offer update checks.
  await expect.poll(() => win.getByTestId('build-kind').innerText()).toContain('Source build')
  expect(await win.getByRole('button', { name: 'Check now' }).count()).toBe(0)
  await win.getByRole('button', { name: 'All settings' }).click()

  await win.getByRole('button', { name: /^Feedback\b/ }).click()
  for (const name of ['Report a bug', 'Request a feature', 'Ask a question']) {
    expect(await win.getByRole('button', { name }).count()).toBe(1)
  }
  const attach = win.getByRole('switch', { name: /Attach my latest diagnostics reference/ })
  expect(await attach.isDisabled()).toBe(true)
  expect(shell.errors).toEqual([])
  await shell.close()
})

it('applies a skin live and keeps it across a relaunch', async () => {
  const skin = (win: Awaited<ReturnType<typeof launchShell>>['win']): Promise<string | null> =>
    win.evaluate(() => document.documentElement.getAttribute('data-skin'))

  const first = await launchShell(env, fixture)
  await openView(first.win, 'Settings')
  await first.win.getByRole('button', { name: /^Appearance\b/ }).click()
  const infernal = first.win.getByRole('button', { name: /^Infernal\b/ })
  await infernal.click()
  expect(await infernal.getAttribute('aria-pressed')).toBe('true')
  expect(await skin(first.win)).toBe('infernal')
  await first.close()

  const second = await launchShell(env, fixture)
  expect(await skin(second.win)).toBe('infernal')
  expect([...first.errors, ...second.errors]).toEqual([])
  await second.close()
})
