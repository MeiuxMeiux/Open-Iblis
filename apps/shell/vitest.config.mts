import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The workspace currently resolves Vite 6 for Svelte and Vite 5 for Vitest.
  // Their runtime plugin hooks are compatible; only the duplicate types differ.
  plugins: [svelte() as never],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The real `electron` module needs a native binary that can't load
    // headless; main-process unit tests use a lightweight stub instead.
    alias: {
      electron: resolve(__dirname, 'tests/electron-stub.ts'),
      './waveform-worker?nodeWorker': resolve(__dirname, 'tests/analysis-worker-stub.ts')
    },
    // `just shell-coverage`. Floors are the 2026-09 baseline
    // (docs/quality/baseline-2026-09.md); raise them as tests land, never lower.
    coverage: {
      provider: 'v8',
      include: ['electron/**/*.ts', 'src/**/*.{ts,svelte}', 'shared/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'json'],
      thresholds: {
        lines: 48,
        branches: 45,
        functions: 40,
        statements: 45,
        'electron/main/**': { lines: 68, branches: 62, functions: 56, statements: 65 }
      }
    }
  }
})
