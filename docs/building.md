# Building from source

This page covers setting up a development machine, the recipes, the test
suites, and what a build you make yourself can and cannot do. Every workflow
runs through [`just`](https://github.com/casey/just); `just --list` shows all
recipes with a one-line description.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Git | recent | On Windows, Git for Windows (its `sh.exe` runs the recipes) |
| Node.js | 24 | `package.json` pins the exact version under `devEngines`; pnpm downloads it when yours differs |
| pnpm | 12 | The exact version is the `packageManager` field in `package.json` |
| just | 1.58 or newer | The version CI uses |
| Python | 3.10 or newer | Helper scripts and the trainer sidecar's unit tests |

No global npm packages are needed; every other tool is a workspace
dependency.

## Windows 11 (the target platform)

Iblis is built for Windows, and only Windows runs the real engine and
trainer packs.

1. Install the tools above. Run the recipes from a terminal where Git for
   Windows' `sh.exe` is on `PATH` (Git Bash works). The `Justfile` uses `sh`
   on Windows because `bash.exe` on Windows may launch WSL instead.
2. `just install` installs dependencies and downloads the Electron binary.
3. `just dev` opens the app with hot reload.
4. `just dist` builds an unsigned NSIS installer into `apps/shell/release/`.

A development run is unpackaged, so Electron names its profile folder after
the workspace package rather than the installed app (`%APPDATA%\Iblis\`).
Plugins and tracks from an installed copy are therefore not visible to it,
and it does not change them.

## Linux (development and CI)

Everything except the native engine and trainer runs on Linux: the UI, the
plugin host, the library, the test suites, and the production bundle.

1. Install the tools above, plus `xvfb` (for `xvfb-run`) and the usual
   Chromium runtime libraries so Electron can start.
2. `just install`
3. `just lint`, `just typecheck`, `just test`, `just build`
4. `just dev` needs a desktop session. On a headless machine, use the
   test recipes, which start Electron under `xvfb-run`.

The engine pack's binaries are Windows CUDA builds, so generation with the
real engine needs Windows. The E2E suite uses the fixture engine instead,
which is plain Node.

## Recipes

| Recipe | What it does |
| --- | --- |
| `just install` | `pnpm install` for the workspace, then the Electron binary |
| `just dev` | Build the SDK, then run the app with hot reload |
| `just build` | Build the SDK and bundle main, preload, and renderer into `apps/shell/out/` |
| `just dist` | `build` plus electron-builder: unsigned installer in `apps/shell/release/` |
| `just lint` | CSS style scan, ESLint and Prettier (SDK and shell), emoji scan of tracked files |
| `just format` | Prettier over the shell |
| `just typecheck` | TypeScript for the SDK; svelte-check and TypeScript for the shell |
| `just test` | Vitest in every workspace package, then the trainer's Python `unittest` suite |
| `just e2e` | Build, then the renderer E2E suite |
| `just media-test` | Real Electron check of the `iblis-track://` media protocol and `<audio>` |
| `just analysis-test` | Build, then run the bundled waveform worker on a generated WAV |
| `just processor-test` | Build, then run the bundled BPM/key detector worker |
| `just sdk-build` | Compile `@iblis/plugin-sdk` to `packages/plugin-sdk/dist/` |
| `just sdk-docs` | TypeDoc API reference in `packages/plugin-sdk/api-docs/` |
| `just catalog-verify <dir>` | Verify `catalog.json` + `catalog.json.sig` in a folder against the shipped key |
| `just training-pack-build` | Build the trainer runtime archive from pinned inputs (multi-GB download) |

`just lint` lists files with `git ls-files`, so run it inside a Git checkout.

## Tests

- **Unit tests** (`just test`). Vitest suites in `apps/shell/tests/` and
  `packages/plugin-sdk/tests/`, plus the trainer sidecar tests in
  `packages/plugins/acestep-training/tests/`. Coverage floors live in each
  `vitest.config`; they only go up.
- **Contract fixtures.** `contracts/` holds golden files for wire formats the
  app shares with the hosted service (leases, the Styles index, diagnostics
  uploads, safetensors checks). The shell's tests read them; see
  `contracts/README.md`.
- **Renderer E2E** (`just e2e`). Playwright drives the built Electron app.
  Each run gets a throwaway profile, and a loopback fixture server stands in
  for the catalog and hosted service, so the suite never touches the network
  or your own data. The specs in `apps/shell/e2e/` cover navigation, the
  Library, Plugins, Settings, Create against the fixture engine, and Training
  against a fixture training pack, with an accessibility (axe) check on each
  view. On Linux the suite runs under `xvfb-run -a`; on Windows and macOS it
  opens real windows.
- **Worker and protocol checks** (`just media-test`, `just analysis-test`,
  `just processor-test`). Start real Electron or Node workers against
  generated audio to prove the bundled code works, not just the sources.

## What a source build can and cannot do

A build you make yourself runs the same code as the official app. It can:

- generate music, train Styles locally, and manage your library;
- install plugins from the official signed catalog (the public key is in the
  source), and browse community Styles.

It cannot, or should not be expected to:

- **auto-update.** Source builds do not follow the official update feed.
  Rebuild from a newer commit to update.
- **carry a code signature.** Windows SmartScreen may warn about an unsigned
  installer.
- **present itself as official.** Settings shows it as a Source build; bug
  reports should say so.

[releases.md](releases.md) has the details, including the current status of
the update-feed separation.

## Troubleshooting

- **"Electron binary is missing"**: run `just install` (Electron downloads its
  binary in a separate step).
- **"no shell bundle; run just build"**: `just e2e`, `just analysis-test`, and
  `just processor-test` need `apps/shell/out/`; they build it first, but a
  failed build leaves it missing.
- **"xvfb-run is required"**: install `xvfb` on Linux.
- **Node version errors**: let pnpm manage Node (`devEngines`), or install
  the version in `package.json`.
- **Recipes fail oddly on Windows**: make sure `sh.exe` from Git for Windows
  is first on `PATH`, not WSL's `bash.exe`.
