// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { axeViolations, openView, toneWav, useShell } from './harness'

// Training against the fixture training pack (fixtures/training-pack): a Node
// stand-in for the Python trainer's loopback wire, so the wizard scan, the
// durable pipeline, restart recovery, and the hand-off to the upload flow all
// run for real without a GPU toolchain. A fake nvidia-smi reports a 16 GB card.
// There is no product key, so the community service is never called: a new
// training runs privately (name checked locally, style registered locally),
// and the recovered community run stops at the lease gate when it uploads.

const TRAINING_ID = 'tr-0123456789abcdef'
const STAGES = ['scan', 'stems', 'tag', 'dataset', 'train-texture', 'export', 'upload', 'pulldown']

// A run that was mid-scan when the previous session closed. On load the store
// recovers it to "interrupted" with the scan re-queued.
const interrupted = {
  id: 'tj-e2e-interrupted',
  name: 'moss-garden',
  trainingId: TRAINING_ID,
  version: 1,
  claimToken: 'c'.repeat(48),
  categories: ['texture'],
  folder: { trackCount: 3, totalDurationSec: 60 },
  consent: { publicUploadAcknowledgedAt: 1_790_000_000_000, rightsAttestedAt: 1_790_000_000_000 },
  stages: STAGES.map((name) => ({
    name,
    status: name === 'scan' ? 'active' : 'queued',
    percent: 0
  })),
  artifacts: [],
  status: 'running',
  createdAt: 1_790_000_000_000,
  updatedAt: 1_790_000_000_000,
  folderPath: '{root}/songs',
  scratchDir: `{root}/data/training/${TRAINING_ID}`,
  vramTotalMb: 16384
}

const session = useShell({
  trainingPack: true,
  gpuVramMb: 16384,
  trainingJobs: [interrupted]
})

function songsFolder(): string {
  const folder = join(session.env.root, 'songs')
  mkdirSync(folder, { recursive: true })
  for (const name of ['one.wav', 'two.wav', 'three.wav']) {
    writeFileSync(join(folder, name), toneWav(20))
  }
  writeFileSync(join(folder, 'notes.txt'), 'lyrics draft\n')
  return folder
}

it('opens Training once the pack is installed and passes the hardware check', async () => {
  const { win } = session.shell
  await openView(win, 'Training')
  await expect.poll(() => win.locator('h1:visible').allInnerTexts()).toEqual(['Training'])
  await expect.poll(() => win.getByText('16 GB of VRAM available.').count()).toBe(1)
  expect(await win.getByText('The training pack is installed.').count()).toBe(1)
})

it('recovers a run the previous session left mid-stage', async () => {
  const { win } = session.shell
  const row = win.getByRole('listitem').filter({ hasText: 'moss-garden' })
  await expect.poll(() => row.count()).toBe(1)
  expect(await row.innerText()).toMatch(/Interrupted/)
  expect(await row.innerText()).toMatch(/previous Iblis session closed/)
  expect(await row.getByRole('button', { name: 'Resume' }).count()).toBe(1)
})

it('scans a song folder through the training sidecar', async () => {
  const { app, win } = session.shell
  const folder = songsFolder()
  // The native folder picker cannot be driven; answer it from main instead.
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] })
  }, folder)

  await win.getByRole('button', { name: 'New training…' }).click()
  await win.getByRole('button', { name: 'Choose folder…' }).click()
  await expect.poll(() => win.getByText('3 tracks / 1 min').count()).toBe(1)
  expect(await win.getByText('Skipped: notes.txt (not an audio file)').count()).toBe(1)
  const next = win.getByRole('button', { name: 'Continue' })
  expect(await next.isDisabled()).toBe(false)
  await next.click()
})

it('checks the name locally and trains privately without a product key', async () => {
  const { win } = session.shell
  expect(
    await win.getByText('This training stays on this machine. A product key lets you').count()
  ).toBe(1)
  await win.getByRole('textbox', { name: 'Training name' }).fill('moss-garden')
  await win.getByRole('button', { name: 'Check availability' }).click()
  // Taken by the recovered job on this machine: refused locally.
  await expect.poll(() => win.getByText('already uses this name').count()).toBe(1)
  await win.getByRole('textbox', { name: 'Training name' }).fill('fern-static')
  await win.getByRole('button', { name: 'Check availability' }).click()
  await expect.poll(() => win.getByText('fern-static is free on this machine.').count()).toBe(1)
  await win.getByRole('button', { name: 'Continue' }).click()

  // Private consent: no public-upload disclosure, the rights attestation stays.
  expect(await win.getByRole('switch').count()).toBe(1)
  await win.getByRole('switch', { name: /I hold the rights/ }).click()
  await win.getByRole('button', { name: 'Continue' }).click()
  expect(await win.getByText('added to your Styles, marked Private').count()).toBe(1)
  await win.getByRole('button', { name: 'Start training "fern-static"' }).click()

  const row = win.getByRole('listitem').filter({ hasText: 'fern-static' })
  await expect.poll(() => row.innerText(), { timeout: 60_000, interval: 500 }).toMatch(/Private/)
  expect(await row.innerText()).not.toMatch(/upload/i)
  expect(await axeViolations(win)).toEqual([])
})

it('lists the private training in Styles with a Private badge', async () => {
  const { win } = session.shell
  await openView(win, 'Styles')
  const card = win.locator('[aria-label="Installed styles"]').getByText('fern-static')
  await expect.poll(() => card.count()).toBe(1)
  await expect
    .poll(() => win.locator('[aria-label="Installed styles"]').innerText())
    .toMatch(/Private/)
  await openView(win, 'Training')
})

it('resumes the interrupted run through every local stage', { timeout: 120_000 }, async () => {
  const { win } = session.shell
  const row = win.getByRole('listitem').filter({ hasText: 'moss-garden' })
  await row.getByRole('button', { name: 'Resume' }).click()
  await expect
    .poll(() => win.getByRole('heading', { name: 'Training "moss-garden"' }).count())
    .toBe(1)
  expect(await win.getByRole('button', { name: 'Cancel training' }).count()).toBe(1)
  expect(await axeViolations(win)).toEqual([])

  // Six local stages at ~1-2 s each, then the upload flow takes over.
  await expect
    .poll(() => row.innerText(), { timeout: 60_000, interval: 500 })
    .toMatch(/Awaiting upload/)
  const text = await row.innerText()
  expect(text).toMatch(/16gb tier \/ rank 64 \/ adamw/)
  expect(text).toMatch(/Upload failed: .*activated product key/)
  expect(await row.getByRole('button', { name: 'Retry upload' }).count()).toBe(1)
})

it('has no axe violations on Training', async () => {
  expect(await axeViolations(session.shell.win)).toEqual([])
})

it('never calls the community service without a key and logs no renderer errors', () => {
  const allowed = [
    '/api/v2/catalog.json',
    '/api/v2/catalog.json.sig',
    '/trainings/index.json',
    '/trainings/index.json.sig'
  ]
  expect(session.fixture.requests.filter((path) => !allowed.includes(path))).toEqual([])
  expect(session.shell.errors).toEqual([])
})
