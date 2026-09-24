# Iblis

Iblis is a local-first AI music workstation for Windows 11. You describe a
song, the app composes it on your own NVIDIA GPU, and the result lands in a
private library on your disk. You can also train a Style (a LoRA adapter) from
a folder of your own music and generate with it. Nothing is rendered in the
cloud, and your files and the app itself are never locked behind an account.

The desktop app is a thin Electron shell that hosts signed, hot-swappable
plugins. Music engines and the trainer run as separate processes on
`127.0.0.1`, supervised by the shell. The shell verifies every plugin it
installs against an Ed25519-signed catalog, so the website that serves the
catalog cannot push code the maintainers did not sign.

## Status

- **Alpha.** Expect rough edges and breaking changes between versions.
- **Free.** The app is free to download and use with no account. A product key
  only unlocks hosted services: publishing and downloading community Styles,
  and uploads to the Iblis service.
- **Open source.** The desktop app, plugin SDK, and plugin packs are in this
  repository under the licenses in [License](#license).

## Screenshots

Real captures of the current alpha in the default Dark 3D skin, taken by
`just screenshots` against the test engine.

| Create | Library |
| --- | --- |
| ![Create view: prompt, engine card, profile, and the engine's own advanced controls](https://iblis.meiuxmeiux.com/assets/img/app/create.png) | ![Library view: folders, generated and imported tracks, and the persistent player](https://iblis.meiuxmeiux.com/assets/img/app/library.png) |

| Styles | Training |
| --- | --- |
| ![Styles view: trained, community, and imported adapters with acknowledgement gating](https://iblis.meiuxmeiux.com/assets/img/app/styles.png) | ![Training view: hardware check for GPU memory, scratch disk, queue, and the training pack](https://iblis.meiuxmeiux.com/assets/img/app/training.png) |

| Settings | Library in the Infernal skin |
| --- | --- |
| ![Settings hub: cards for Appearance, Engine, Audio analysis, Cloud providers, Data location, Diagnostics, Feedback, and Updates](https://iblis.meiuxmeiux.com/assets/img/app/settings.png) | ![Library in the Infernal skin](https://iblis.meiuxmeiux.com/assets/img/app/library-infernal.png) |

## Features

- **Generate.** Text-to-music with ACE-Step 1.5 through `acestep.cpp`. Prompt,
  optional lyrics, duration, and seeds; a serial queue that survives restarts,
  with Stop and Resume; blind A/B comparison of two settings.
- **Train your own Style.** Point the Training section at a folder of your
  songs. The app separates stems, tags the audio, builds datasets, and trains
  a Texture and/or Groove LoRA locally. See [docs/training.md](docs/training.md).
- **Styles library.** Your trained and imported adapters, plus community Styles
  from a signed index. Pick one in Create and generate with it.
- **Library, playback, analysis.** Waveforms, levels, and built-in BPM and key
  detectors that run in a worker thread. Each detector shows its license.
- **Plugins.** Engines, processors, the trainer, cloud-provider adapters, and
  skins install from the signed catalog, update in place, and roll back. See
  [docs/plugins.md](docs/plugins.md).
- **Skins.** Every color, font, radius, and spacing value is a design token.
  Four built-in skins, an in-app token editor, and skins as plugins. See
  [docs/skins.md](docs/skins.md).

## Requirements

| | Minimum |
| --- | --- |
| OS | Windows 11, 64-bit |
| GPU (generation and training) | NVIDIA with 8 GB VRAM and a current driver |
| Disk | About 8 GB for the engine pack; the optional training pack is several GB more |
| Network | Only to download the app and plugin packs; generation and training run offline |

## Install

Download the official installer from
<https://iblis.meiuxmeiux.com/download>. Official builds are produced by the
maintainers' release pipeline and update themselves: the app checks for a new
version at launch and from Settings, Updates. On first run, Create offers to
install the engine pack from the signed catalog.

## Build from source

You need Node 24, pnpm, [`just`](https://github.com/casey/just), and Python 3.
The workspace pins the exact Node version in `package.json` (`devEngines`), and
pnpm downloads it for you. On Windows, run the recipes from a shell where Git
for Windows' `sh.exe` is on `PATH`.

```
just install      # workspace dependencies + the Electron binary
just dev          # open the app with hot reload (needs a desktop session)
just build        # bundle main, preload, and renderer into apps/shell/out/
just lint         # style scan, ESLint, Prettier, emoji scan
just typecheck    # svelte-check + TypeScript
just test         # unit tests in every package + the trainer sidecar tests
just e2e          # renderer E2E: Playwright over the built app (xvfb on Linux)
just dist         # unsigned Windows installer in apps/shell/release/ (on Windows)
```

`just --list` shows every recipe. [docs/building.md](docs/building.md) covers
Windows and Linux setup, the E2E suite, and troubleshooting.

What a source build can do: everything the app does locally. It generates,
trains, manages your library, and installs plugins from the same signed
catalog as the official app.

What it cannot do: it is not code-signed, it does not auto-update, and
Settings shows it as a **Source build**. It is not an official release, so
the maintainers can only support it on a best-effort basis.
[docs/releases.md](docs/releases.md) explains the difference, the status of
the update-feed split, and how to match an official version to a public
commit.

## Architecture

```
+-------------------------- Iblis shell (Electron) ---------------------------+
|  Renderer (Svelte 5)                Main process                            |
|  Create, Library, Styles,   <--->   plugin host, catalog client, queue,     |
|  Training, Plugins, Settings  IPC   library store, updater, network owner   |
|  (no network, no paths)                     |                               |
+---------------------------------------------|-------------------------------+
                                              | spawn + HTTP on 127.0.0.1
                                              | (per-session secret header)
                        +---------------------+----------------------+
                        |                     |                      |
                  engine sidecar       training sidecar       processor sidecar
                  (acestep.cpp)        (embedded trainer)     (optional)

  Signed catalog (Ed25519) ---> main verifies ---> SHA-256-checked plugin assets
  Hosted services (product key) ---> community Styles, uploads
```

- The **renderer** never touches the network or the filesystem. It talks to
  the main process through typed IPC only.
- The **main process** owns the network, plugin installs, sidecar
  supervision, the generation queue, and the library.
- **Sidecars** bind to loopback only and refuse requests without the
  per-session secret. Engines speak the contract in
  [docs/engine-contract.md](docs/engine-contract.md).
- The **signed catalog** is the trust root for plugins. The public key ships
  in the app.
- **Hosted services** (key activation, community Styles publishing, uploads)
  run on the Iblis website. Their server code is not in this repository.

More in [docs/architecture.md](docs/architecture.md).

## Plugin SDK quickstart

`@iblis/plugin-sdk` (Apache-2.0) holds the plugin contracts and their runtime
validators: `PluginManifest`, `parseManifest`, `parseCatalog`, the skin token
list (`SKIN_TOKENS`, `parseSkinDescriptor`), and the engine contract v2 types
and parsers (`parseEngineDescriptorV2`, `parseEngineRecipeV2`,
`parseEngineJobStateV2`). A minimal skin plugin manifest:

```json
{
  "id": "com.example.skin.midnight",
  "name": "Midnight",
  "version": "1.0.0",
  "kind": "skin",
  "hostMinVersion": "0.2.0-alpha.43",
  "capabilities": [],
  "assets": [
    {
      "path": "skin.json",
      "sha256": "<64 lowercase hex characters>",
      "bytes": 812,
      "sources": [{ "kind": "vendor", "url": "https://example.com/midnight/1.0.0/skin.json" }]
    }
  ],
  "license": "MIT",
  "author": { "name": "Example" }
}
```

Validate it the way the shell does:

```ts
import { parseManifest } from '@iblis/plugin-sdk'

const result = parseManifest(JSON.parse(text))
if (!result.ok) console.error(result.errors.join('\n'))
```

`just sdk-docs` generates the API reference. Plugins reach users through the
signed catalog, which only the maintainers can sign; open an issue to propose
one. [docs/plugins.md](docs/plugins.md) covers kinds, install layout, and
signature verification.

## License

| Path | License |
| --- | --- |
| `apps/shell/` | GPL-3.0-or-later ([LICENSE](LICENSE)) |
| `packages/plugin-sdk/` | Apache-2.0 ([packages/plugin-sdk/LICENSE](packages/plugin-sdk/LICENSE)) |
| `packages/plugins/*/` | MIT (the `license` field of each manifest) |
| `scripts/`, `tools/`, build configuration | GPL-3.0-or-later |
| `contracts/` | Apache-2.0 |
| Documentation | CC-BY-4.0 |
| `packages/brand/` | All rights reserved (see [TRADEMARKS.md](TRADEMARKS.md)) |

Every file carries an SPDX header or is covered by [REUSE.toml](REUSE.toml);
license texts are in [LICENSES/](LICENSES/). Third-party components and their
licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Model
weights keep their own licenses; they are downloaded by plugin packs, not
stored here.

## Trademarks

"Iblis" and the Iblis logo are trademarks of Meiux Meiux LLC. The licenses
above cover the code, not the name or logo. A fork must use its own name,
icons, app id, and update feed. [TRADEMARKS.md](TRADEMARKS.md) has the details.

## Roadmap

What is shipped, what is next, and what is still only intent is kept in one
place: <https://iblis.meiuxmeiux.com/roadmap>. It lists the unbuilt features
by area with their current status, and it is updated with every release.
Feature requests accepted from GitHub issues and the website's feedback form
are folded into it.

## Reporting bugs and asking questions

- **GitHub issues** for bugs, feature requests, and questions. The forms ask
  for your version, build type, GPU, and an optional diagnostics reference.
  Diagnostics are off by default; to get a reference, pick a level in
  Settings, Diagnostics and press Send diagnostics now.
- **No GitHub account?** Use the form at <https://iblis.meiuxmeiux.com/feedback>.
- **Security issues:** do not open a public issue. Follow
  [SECURITY.md](SECURITY.md).
- Anything else: iblis@meiuxmeiux.com.

Contributions are welcome under the DCO; read
[CONTRIBUTING.md](CONTRIBUTING.md) first. Project roles and decisions are in
[GOVERNANCE.md](GOVERNANCE.md), and everyone here follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## What is not in this repository

This repository is the open-source client. These parts stay private:

- **Server code.** The website, catalog hosting, product-key issuance and
  leases, community Styles ingest, diagnostics intake, and the admin panel.
- **Signing.** The catalog and lease private keys, and the tooling that uses
  them. The matching public keys are in `apps/shell/electron/main/keys/`.
- **Release pipeline.** The CI that builds, signs, and publishes official
  installers and engine binaries, and uploads plugin assets.
- **Internal documents.** Planning notes, operational runbooks, and session
  history.

The public tree is exported from the maintainers' repository. Pull requests
here are reviewed here, applied upstream with your authorship and sign-off,
and come back in the next sync; see [CONTRIBUTING.md](CONTRIBUTING.md).
