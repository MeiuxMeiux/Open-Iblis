// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Song idea through the GUI against a fake OpenAI-compatible server on
// 127.0.0.1: set up Local model in Settings, then ask from Create, cancel
// once, and insert the preview. The fake server records every request.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { openView, useShell } from './harness'

const session = useShell({ plugins: ['fixture-engine'] })
const requests: string[] = []
let server: Server
let port = 0
// The first chat request hangs so the dialog's Cancel can be exercised.
let hangNext = true

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(`${req.method ?? ''} ${req.url ?? ''}`)
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'fake-writer' }] }))
      return
    }
    if (hangNext) {
      hangNext = false
      return
    }
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'dusty trip hop, 84 bpm, vinyl' } }]
        })
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

it('sets up a local model from Settings', async () => {
  const { win } = session.shell
  await openView(win, 'Settings')
  await win.getByRole('button', { name: /^Local model\b/ }).click()
  await win.getByRole('switch', { name: /^Use a local model/ }).click()
  await win.getByRole('spinbutton', { name: /^Port/ }).fill(String(port))
  await win.getByRole('button', { name: 'Save address' }).click()
  await win.getByRole('button', { name: 'Test connection' }).click()
  await expect.poll(() => win.getByText('1 model available: fake-writer').count()).toBe(1)
  expect(requests).toEqual(['GET /v1/models'])
})

it('writes a song idea into the prompt only on Insert', async () => {
  const { win } = session.shell
  await openView(win, 'Create')
  const prompt = win.getByRole('textbox', { name: 'Prompt' })
  await win.getByRole('button', { name: 'Song idea' }).click()
  const dialog = win.getByRole('dialog', { name: 'Song idea' })
  await expect
    .poll(() => dialog.getByRole('combobox', { name: 'Provider' }).inputValue())
    .toBe('local')
  expect(await dialog.getByRole('combobox', { name: 'Model' }).inputValue()).toBe('fake-writer')
  await dialog.getByRole('button', { name: 'Review' }).click()
  expect(await dialog.getByText('Runs on this computer.', { exact: false }).count()).toBe(1)

  await dialog.getByRole('button', { name: 'Write with local model' }).click()
  await dialog.getByRole('button', { name: 'Cancel request' }).click()
  await dialog.getByRole('button', { name: 'Write with local model' }).waitFor()
  expect(await prompt.inputValue()).toBe('')

  await dialog.getByRole('button', { name: 'Write with local model' }).click()
  const preview = dialog.getByRole('textbox', { name: /^Preview/ })
  await expect.poll(() => preview.inputValue()).toBe('dusty trip hop, 84 bpm, vinyl')
  expect(await prompt.inputValue()).toBe('')
  await dialog.getByRole('button', { name: 'Insert' }).click()
  await expect.poll(() => prompt.inputValue()).toBe('dusty trip hop, 84 bpm, vinyl')
  expect(requests.filter((r) => r === 'POST /v1/chat/completions')).toHaveLength(2)
  expect(session.fixture.requests.some((path) => path.includes('chat'))).toBe(false)
  expect(session.shell.errors).toEqual([])
})
