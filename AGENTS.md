# AGENTS.md

Guidance for coding agents working in this repository. Humans: see
CONTRIBUTING.md, which says the same things at more length.

- `just` is the only entrypoint; add a recipe for any new workflow.
- No emojis anywhere (code, docs, commits, UI). Icons come from the SVG sprite.
  `just lint` enforces it.
- Strict TypeScript. The renderer never touches the network or the
  filesystem; all I/O goes through the main process over typed IPC, and every
  handler returns `{ ok: true, data } | { ok: false, error }`.
- UI code uses skin tokens (docs/skins.md), never literal colors or sizes.
- New source files start with SPDX copyright and license headers matching
  their directory (see CONTRIBUTING.md).
- Soft size caps: about 400 lines per file, 80 per function, 250 per CSS file.
- Commits carry a DCO sign-off (`git commit -s`).
- Run `just lint`, `just typecheck`, and `just test` before proposing a change.
- Architecture and contracts: docs/architecture.md, docs/plugins.md,
  docs/engine-contract.md.
