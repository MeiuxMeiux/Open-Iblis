# Contributing to Iblis

Thanks for helping. This file covers setup, the rules a change must follow,
and how a pull request travels from this repository into a release.

Before starting anything larger than a small fix, open an issue (or comment on
an existing one) so we can agree on the approach. It saves both sides a
rewrite.

## Setup

Prerequisites: Git, Node 24, pnpm, [`just`](https://github.com/casey/just),
and Python 3. pnpm reads the pinned Node version from `package.json`
(`devEngines`) and downloads it if yours differs.

```
git clone https://github.com/MeiuxMeiux/Open-Iblis.git
cd Open-Iblis
just install
just test
```

[docs/building.md](docs/building.md) has platform notes for Windows and Linux.

## `just` is the only entrypoint

Every workflow is a recipe in the `Justfile`. If you add a workflow, add a
recipe; do not document raw `pnpm`, `node`, or `python` invocations.

| Recipe | What it does |
| --- | --- |
| `just install` | Install workspace dependencies and the Electron binary |
| `just dev` | Run the app with hot reload (needs a desktop session) |
| `just build` | Bundle the app into `apps/shell/out/` |
| `just dist` | Unsigned Windows installer (run on Windows) |
| `just lint` | Style scan, ESLint, Prettier check, emoji scan |
| `just format` | Apply Prettier to the shell |
| `just typecheck` | svelte-check and TypeScript for the SDK and shell |
| `just test` | Unit tests in every package, plus the trainer sidecar tests |
| `just e2e` | Renderer E2E: Playwright over the built Electron app |
| `just media-test` | Real Chromium check of the local media protocol |
| `just analysis-test` | Run the bundled waveform worker on a generated WAV |
| `just processor-test` | Run the bundled BPM/key detector worker |
| `just sdk-build` | Build `@iblis/plugin-sdk` |
| `just sdk-docs` | Generate the SDK API reference (TypeDoc) |
| `just catalog-verify <dir>` | Verify a signed catalog against the shipped public key |
| `just training-pack-build` | Build the trainer runtime pack (multi-GB download) |

## Sign your commits (DCO)

Every commit must carry a `Signed-off-by` line certifying the
[Developer Certificate of Origin](https://developercertificate.org/): that you
wrote the change or otherwise have the right to submit it under the project's
licenses. Use your real name and the email address on the commit:

```
git commit -s -m "fix(library): keep scroll position after delete"
```

`-s` appends `Signed-off-by: Your Name <you@example.com>` from your Git
config. To sign commits you already made on a branch:

```
git rebase --signoff main
```

A check on every pull request fails if any commit lacks a sign-off matching
its author. We do not use a CLA.

## Rules every change follows

- **No emojis, anywhere.** Code, comments, docs, commit messages, PR titles,
  and UI text. Icons come from the SVG sprite in `packages/brand/icons/`.
  `just lint` fails on an emoji.
- **SPDX headers.** Every new source file starts with a copyright line and a
  license identifier matching its directory:

  ```ts
  // SPDX-FileCopyrightText: 2026 Your Name
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```

  Use `GPL-3.0-or-later` under `apps/shell/`, `scripts/`, and `tools/`;
  `Apache-2.0` under `packages/plugin-sdk/`; `MIT` under
  `packages/plugins/`. Files that cannot hold a comment (JSON, images) are
  covered by `REUSE.toml`.
- **Strict TypeScript.** `strict` and `noUncheckedIndexedAccess` stay on. Do
  not add `any` or non-null assertions to silence the checker.
- **The renderer never touches the network or the filesystem.** All I/O goes
  through the main process over typed IPC, and every handler returns
  `{ ok: true, data } | { ok: false, error }`. The renderer's CSP blocks
  network access.
- **Design tokens only.** UI code uses the skin tokens
  ([docs/skins.md](docs/skins.md)); no hard-coded colors, fonts, radii, or
  spacing.
- **Soft size caps.** About 400 lines per file, 80 per function, 250 per CSS
  file. Past that, split along a real seam. SPDX header lines do not count.
- **Plain copy.** Error messages, labels, progress text, and empty states are
  calm, plain English with no jokes. The brand's one running joke (the soul
  bargain) stays in a few flavor spots such as the welcome card and About,
  and never appears in errors, billing, or anything that reads as a real
  transaction.

## Tests

- New behavior comes with a test that fails without it. Bug fixes come with a
  regression test.
- Unit tests use Vitest (`apps/shell/tests/`, `packages/plugin-sdk/tests/`)
  and `unittest` for the trainer sidecar
  (`packages/plugins/acestep-training/tests/`).
- Renderer changes that affect a view should keep `just e2e` green; add or
  extend a spec in `apps/shell/e2e/` when a flow changes.
- Wire-format changes update the golden files in `contracts/` in the same
  change (see `contracts/README.md`).
- Coverage floors in the Vitest configs only go up.

Before opening a pull request, run:

```
just lint
just typecheck
just test
just build
```

## How CI runs

The `ci` workflow runs on every push and pull request against `main`:
install with the frozen lockfile, then `just lint`, `just typecheck`,
`just test`, and `just build` on Ubuntu, plus the renderer E2E suite under
xvfb. The `dco` workflow checks sign-offs. Neither uses repository secrets,
so they run the same for forks.

## Pull requests

1. Fork, branch from `main`, keep the change focused.
2. Fill in the pull request template. Link the issue it resolves.
3. A maintainer reviews here, on GitHub. Expect questions; small follow-up
   commits are fine.

### How an accepted pull request lands

This repository is exported from the maintainers' repository, which also
holds the private server code. When your pull request is approved:

1. A maintainer applies its commits to the upstream repository with
   `git am`, which keeps you as the author and keeps your `Signed-off-by`
   lines.
2. The next sync publishes a new snapshot here that includes your change.
3. The pull request is then closed with a link to the sync commit, rather
   than merged with GitHub's button.

Your commits keep your name in the upstream history. Because the sync
publishes a snapshot, the public history shows the sync commit rather than
your individual commits; the link on your pull request connects the two.

## Repository settings (maintainers)

Branch protection, required status checks, secret scanning with push
protection, private vulnerability reporting, Dependabot alerts and security
updates, and CodeQL code scanning live in the repository settings, not in
files here. Dependabot version updates are configured in
`.github/dependabot.yml`. [GOVERNANCE.md](GOVERNANCE.md) says who manages
them.
