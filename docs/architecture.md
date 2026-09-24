# Architecture

Iblis is a thin host (the Electron shell), a strict plugin contract, and a
token-based skin engine. Model inference, training, and analysis run in
plugins; the shell decides what runs, verifies it, and keeps your data.

```
                         Iblis shell (Electron)
  +-----------------------------+      +-----------------------------------+
  | Renderer (Svelte 5)         |      | Main process                      |
  |  Home, Create, Library,     | IPC  |  plugin host + install queue      |
  |  Styles, Training, Plugins, |<---->|  catalog client (signature check) |
  |  Settings, skin engine      |      |  generation queue, library store  |
  |  no network, no file paths  |      |  training pipeline, updater       |
  +-----------------------------+      +----------------+------------------+
                                                        |
                        execFile + HTTP on 127.0.0.1, per-session secret
                                                        |
               +--------------------+-------------------+-------------------+
               |                    |                                       |
         engine sidecar       training sidecar                     processor sidecar
         (acestep.cpp,        (embedded Python                     (optional analysis
          or a v2 engine)      trainer, on demand)                  and transforms)
```

## The contracts

All of these live in `packages/plugin-sdk/` (Apache-2.0) as types plus
defensive runtime parsers.

1. **PluginManifest** (`manifest.ts`, `validate.ts`). Id, kind, version,
   minimum host version, SHA-256-pinned assets, optional sidecar executable.
   See [plugins.md](plugins.md).
2. **SkinContract** (`skin-contract.ts`). The closed list of design tokens
   every UI primitive consumes and every skin may redefine. See
   [skins.md](skins.md).
3. **Engine contract** (`engine.ts`, `engine-v2.ts`, `engine-v2-jobs.ts`). How
   an engine sidecar describes what it can do and runs jobs. See
   [engine-contract.md](engine-contract.md).
4. **Processor contract** (`processor.ts`). Normalized BPM and key results for
   analysis providers.
5. **Catalog** (`catalog.ts`). The signed list of plugins and versions.

`slots.ts` reserves names for future UI extension points. The current shell
does not load plugin UI code, so nothing depends on slots yet.

## Process model

- **Main process.** One instance. Owns the window, the plugin host, sidecar
  supervision, the catalog client, the generation queue, the library, the
  training pipeline, settings, logs, and every outbound network request.
- **Preload.** Exposes a typed `window.iblis.*` API through `contextBridge`.
  Every call returns `{ ok: true, data }` or `{ ok: false, error }`.
- **Renderer.** Svelte 5 without SvelteKit. Runs with `contextIsolation`,
  `sandbox`, and no Node integration. Its Content Security Policy blocks
  network access (`connect-src 'none'`). It never receives filesystem paths;
  audio reaches it through the `iblis-track://` protocol by track id.
- **Sidecars.** One process per running native plugin, started with
  `execFile` and an argument array. Each binds to a free port on
  `127.0.0.1`, receives a random per-session secret in an environment
  variable, and must refuse requests without the `X-Iblis-Session` header.
  The supervisor restarts a crashed sidecar and stops after more than three
  crashes in 60 seconds, then reports the failure. All sidecars stop when the
  app quits.

Work that competes for the GPU is serialized. A resource lock has four
states: idle, generating, training, and engine mutation (install, update,
rollback). Training stops the engine to free VRAM and restores it afterward;
generation is refused with a plain message while training runs, and the other
way round.

## Storage layout

On Windows the profile folder is `%APPDATA%\Iblis\`. Settings, Data location
can move the large data (plugins, tracks, adapters, training scratch, caches)
to an empty folder on another drive; the app moves it and rewrites its
internal paths. The installation directory is never used for data, so
installs and updates can replace it freely.

```
%APPDATA%\Iblis\
  generation-queue.json    pending and recent generation work (atomic writes)
  engine-defaults.json     default engine per operation
  processor-jobs.json      analysis jobs and results
  logs\                    rotated JSON logs
  plugins\<plugin-id>\     (moves with Data location)
    current.txt            the active version
    <version>\             one folder per installed version
  tracks\                  (moves with Data location)
    library.json           the library index
    <track-id>\
      audio.wav
      generation.json      recipe, engine identity, timings
      analysis.v1.json     peaks, levels, silence
  adapters\                Styles (LoRA adapters) you trained or imported
  training\<job-id>\       training scratch and output
```

Every JSON document is written to a temporary file and renamed into place, so
a crash never leaves a half-written file.

## Update channels

| Channel | What | How |
| --- | --- | --- |
| App | The shell | `electron-updater` reads a static feed; the installer is checked against the SHA-512 in that feed |
| Plugins | Engines, trainer, processors, cloud adapters | Signed catalog, then per-asset SHA-256, then hot-swap |
| Skins | Skin plugins | Same catalog path; no process to restart |

The three are independent: an app update does not re-download plugins, and a
plugin update does not need an app update, unless the plugin declares a newer
`hostMinVersion`. Official builds check the app feed at launch, periodically
while in the foreground, and when you press Check now in Settings, Updates.
Development runs (`just dev`) never check for updates; see
[releases.md](releases.md) for how source-built installers are kept off the
official feed.

## Plugin install and hot-swap

1. Download the new version's assets into `plugins/<id>/<new-version>/`. Each
   asset lists its sources in order (vendor first, mirror second); the shell
   falls through on network, HTTP, or hash failure.
2. Verify every asset's SHA-256 and size. Unpack archives only after their
   hash verifies.
3. For a plugin with a sidecar, start the new version and wait for its
   health endpoint.
4. Rewrite `current.txt` atomically and switch to the new process.
5. Stop the old process: terminate, wait, then kill if still running.
6. On any failure in steps 3 to 5, keep the old pointer and process and show
   the error.

Rollback repeats the same steps with the previous version folder. Installs and
updates share one queue, so large downloads never compete.

## Trust and security

- **Catalog signature.** The catalog is signed with Ed25519. The public key
  is compiled into the app (`apps/shell/electron/main/keys/catalog.pub.pem`).
  The shell checks the signature over the exact bytes before parsing, and
  ignores any plugin the signature does not cover. A compromised web server
  cannot publish a plugin without the private key.
- **Asset hashes.** The catalog pins every asset by SHA-256; the download
  source is only a host, never a trust root.
- **Plugins are trusted code.** Catalog plugins are first-party today, and
  sidecars run without a sandbox. A third-party plugin model would need a
  real sandbox first.
- **Loopback only.** Sidecars bind to `127.0.0.1` and require the session
  secret, which keeps other local programs and web pages from driving them.
- **No silent telemetry.** Update and catalog checks reveal your IP address
  and user agent to the server. Diagnostics upload only when you turn them on
  and press Send; the bundle is redacted and size-capped.
- **Hosted services.** Product-key activation returns a signed, time-limited
  lease that the app verifies with a second public key
  (`license.pub.pem`). The lease authenticates community Styles publishing
  and uploads; no shared secret ships in the app.
