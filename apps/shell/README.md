# @iblis/shell

The Iblis desktop app: a thin Electron host written with Vite and Svelte 5
(no SvelteKit). It owns the signed catalog and plugin lifecycle, sidecar
supervision, the generation queue, the library, Styles and Training, skins,
updates, diagnostics, and the typed boundary between main, preload, and
renderer. Model inference runs in plugins. See
[`docs/architecture.md`](../../docs/architecture.md).

Licensed GPL-3.0-or-later ([LICENSE](LICENSE)).

## Layout

```
apps/shell/
  electron/
    main/            main process: plugins, sidecars, engine, queue, library,
                     training, catalog, licensing, updater, IPC handlers
      keys/          public verification keys (catalog, product-key leases)
    preload/         contextBridge surface: window.iblis.*
  shared/            types shared by main, preload, and renderer (IPC contract)
  src/               Svelte 5 renderer: views, UI primitives, skins
  tests/             Vitest unit tests
  e2e/               Playwright-over-Electron specs and fixtures
  index.html         the renderer's Content Security Policy
  electron-builder.yml  Windows installer configuration
```

## Develop

Run every workflow from the repository root with `just`:

```
just install     # workspace dependencies + Electron binary
just dev         # app with hot reload (needs a desktop session)
just build       # bundle into out/
just dist        # unsigned installer in release/ (Windows)
just test        # unit tests
just e2e         # renderer E2E
just lint        # ESLint, Prettier, style and emoji scans
just typecheck   # svelte-check + TypeScript
```

[`docs/building.md`](../../docs/building.md) covers platform setup.

## Rules this package follows

- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`).
- The renderer reaches main only through `window.iblis.*`, with
  `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- The renderer cannot touch the network: the CSP sets `connect-src 'none'`.
- Every IPC handler returns `{ ok: true, data } | { ok: false, error }`.
- UI code uses skin tokens only ([`docs/skins.md`](../../docs/skins.md)).
- Logs are structured JSON under the profile folder's `logs/`.
