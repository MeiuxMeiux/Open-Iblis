// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Entry layout is intentional (see docs/quick-start.md):
//   electron/main    -> main process (window lifecycle, plugin host, IPC)
//   electron/preload -> contextBridge surface (window.iblis.*)
//   src              -> Svelte 5 renderer
// @iblis/plugin-sdk is a zero-dependency workspace package; bundle it into the
// main/preload chunks rather than externalize it, so electron-builder needn't
// package the pnpm workspace symlink.
const externalizeDeps = { exclude: ['@iblis/plugin-sdk'] }
// `just shell-e2e-coverage` builds with source maps so V8 coverage from the E2E
// run maps back to source. Release builds never set it.
const sourcemap = process.env.IBLIS_COVERAGE_BUILD === '1'

export default defineConfig({
  main: {
    // Build-time constants. No shared secret is ever baked here: every service
    // credential is a per-user signed lease (docs/planning/2026-09-24-open-source).
    define: {
      // Licensing enforcement is a BUILD-TIME const (docs/admin/03, K3/K4):
      // baked false while the module ships dark; the K4 release flips the
      // env in CI. Not a remote flag, deliberately.
      'process.env.LICENSING_ENFORCE': JSON.stringify(process.env.LICENSING_ENFORCE ?? 'false'),
      // Official vs source build (electron/main/official-endpoints.ts). Only
      // the release workflow sets 'true'; a source build gets no update feed
      // and no hosted-service endpoints unless its builder configures them.
      'process.env.IBLIS_OFFICIAL_BUILD': JSON.stringify(
        process.env.IBLIS_OFFICIAL_BUILD ?? 'false'
      ),
      // The private processor lab has an independent signing root and is
      // disabled in normal builds. These values are reviewed build inputs, not
      // renderer-visible runtime configuration.
      'process.env.IBLIS_LABS_ENABLED': JSON.stringify(process.env.IBLIS_LABS_ENABLED ?? 'false'),
      'process.env.IBLIS_LAB_CATALOG_PUBKEY': JSON.stringify(
        process.env.IBLIS_LAB_CATALOG_PUBKEY ?? ''
      )
    },
    build: {
      externalizeDeps,
      lib: { entry: resolve(__dirname, 'electron/main/index.ts') },
      sourcemap,
      // Minified like the renderer. Not obfuscation (deliberately out of
      // scope, docs/admin/00-overview.md), just no plain-text source in
      // the shipped asar plus smaller bundles.
      minify: 'esbuild'
    }
  },
  preload: {
    build: {
      externalizeDeps,
      lib: { entry: resolve(__dirname, 'electron/preload/index.ts') },
      sourcemap,
      minify: 'esbuild'
    }
  },
  renderer: {
    root: '.',
    build: {
      sourcemap,
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') }
      }
    },
    plugins: [svelte()]
  }
})
