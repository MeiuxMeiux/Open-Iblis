// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

describe('packaged product identity', () => {
  it('keeps implementation terminology out of Windows-visible identity', () => {
    const packageJson = JSON.parse(read('package.json')) as { description: string }
    const window = read('electron/main/window.ts')
    const document = read('index.html')
    const home = read('src/lib/views/Home.svelte')

    expect(packageJson.description).toBe('Iblis — Soulless Music.')
    expect(window).toContain("title: 'Iblis — Soulless Music'")
    expect(document).toContain('<title>Iblis — Soulless Music</title>')
    expect(document).toContain('media-src iblis-track: iblis-probe:')
    expect(home).not.toContain('Electron {info.electron}')
  })
})
