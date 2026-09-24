import { defineConfig } from 'vitest/config'

// Renderer E2E (`just shell-e2e`): Playwright drives the built shell in a real
// Electron. Files run one at a time; each spec owns its app instance.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // CI runners paint slower than a dev box; polls still end on first success.
    expect: { poll: { timeout: 10_000 } }
  }
})
