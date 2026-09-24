// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Floors are the 2026-09 baseline (docs/quality/baseline-2026-09.md);
    // raise them as tests land, never lower.
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: { lines: 78, branches: 72, functions: 96, statements: 75 }
    }
  }
})
