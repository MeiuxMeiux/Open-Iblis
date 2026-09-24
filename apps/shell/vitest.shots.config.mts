// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { defineConfig } from 'vitest/config'

// Documentation screenshots (`just shell-screenshots`): the E2E harness drives
// the built shell and writes PNGs to IBLIS_SHOTS_DIR. Not part of `just e2e`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/screenshots.shots.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    expect: { poll: { timeout: 10_000 } }
  }
})
