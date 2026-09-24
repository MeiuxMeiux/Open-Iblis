# Plugins

A plugin is a versioned folder on disk, a manifest that describes it, and,
for some kinds, a native sidecar process. The shell installs, updates,
hot-swaps, rolls back, and removes plugins while it runs, without a restart.

The types and validators live in `@iblis/plugin-sdk`
(`packages/plugin-sdk/src/manifest.ts` and `validate.ts`). `just sdk-docs`
generates the full API reference.

## Kinds

The SDK defines eight kinds (`PLUGIN_KINDS`). Five have a working host in the
shell today; three are reserved names.

| Kind | Sidecar | Status | Example in this repo |
| --- | --- | --- | --- |
| `engine` | Yes | Hosted. Generates audio; see [engine-contract.md](engine-contract.md) | `acestep-engine`, `fixture-engine` |
| `processor` | Yes | Hosted. Analysis and transforms on existing tracks | `echo-server` (lifecycle test only) |
| `training` | Yes, on demand | Hosted. The local LoRA trainer; see [training.md](training.md) | `acestep-training` |
| `cloud-provider` | No | Hosted. Declarative adapter for a cloud API the shell calls with the user's own key | `openrouter-provider`, `imagerouter-provider` |
| `skin` | No | Hosted. Design tokens plus optional CSS; see [skins.md](skins.md) | `skin-boodark-nord` |
| `image-gen` | - | Reserved | - |
| `visualizer` | - | Reserved | - |
| `ui-pack` | - | Reserved | - |

The shell does not load plugin JavaScript into the renderer. Reserved kinds
and the reserved UI slot names in `slots.ts` wait on a sandboxed loading
contract; do not build on them yet.

A `cloud-provider` manifest may only name a provider the shell already knows
(`cloudProvider.id` is `openrouter` or `imagerouter`). It carries no URL,
executable, or request code: the shell owns the key, the allowlisted
endpoints, and every request.

## Manifest

```ts
interface PluginManifest {
  id: string                 // reverse-DNS, lowercase: "com.example.engine.foo"
  name: string
  version: string            // SemVer of this plugin version
  kind: PluginKind
  hostMinVersion: string     // oldest shell version that may run it
  capabilities: string[]     // e.g. "text-to-music", "bpm-detect"
  assets: PluginAsset[]      // every file, pinned by SHA-256
  executable?: ExecutableSpec
  presets?: EnginePreset[]   // v1 engines only
  engine?: EngineManifestSection // engine contract v2 opt-in
  configSchema?: Record<string, unknown>
  evaluation?: ProcessorEvaluationV1 // required for BPM/key processors
  cloudProvider?: { id: 'openrouter' | 'imagerouter' }
  license: string            // SPDX id of the plugin code, not model weights
  author: { name: string; url?: string }
  bugUrl?: string
  slots?: SlotRegistration[] // reserved; not loaded by the current shell
}

interface PluginAsset {
  path: string               // relative path inside the version folder
  sha256: string             // lowercase hex
  bytes: number
  sources: { kind: 'vendor' | 'gcs' | 'bundled'; url: string }[] // tried in order, HTTPS
  executable?: boolean       // set the executable bit on POSIX
  unpack?: 'zip'             // extract after the hash verifies, then delete the archive
}

interface ExecutableSpec {
  bin: string                // asset path of the program to run
  args?: string[]
  portArg?: string           // default "--port"
  sessionEnv?: string        // default "IBLIS_SESSION"
  healthPath?: string        // default "/health"
  healthTimeoutMs?: number
  idleUnloadMinutes?: number // v2 engines: unload after this idle time
}
```

`parseManifest(value)` returns `{ ok: true, value }` or
`{ ok: false, errors }` with a field path on every error. It never throws on
bad input, so the shell can reject a malformed manifest even when its
signature is valid.

### Source manifests in this repository

Each folder under `packages/plugins/` has a `manifest.source.json`. It is the
authoring form: assets name a local `file` and URLs may contain `{version}`.
The maintainers' catalog build hashes the files, fills in `sha256` and
`bytes`, uploads the assets, and signs the resulting catalog. A published
pack that is too large to keep in Git is marked `"published": true` with its
hashes already pinned.

### Asset sources

Each asset lists one or more HTTPS sources, tried in order:

1. **vendor**: the original publisher (for example model weights on Hugging
   Face). Preferred, so users get canonical bytes.
2. **gcs**: the project's mirror on Google Cloud Storage, used for
   first-party files and as a fallback.
3. **bundled**: only for tiny critical files.

The shell falls through to the next source on DNS, HTTP, timeout, size, or
hash failure. The hash is the same for every source; a source is a host,
never a trust root.

## Install layout and lifecycle

```
<data>\plugins\<plugin-id>\
  current.txt          the active version (rewritten atomically)
  <version>\           the active version's files
  <previous-version>\  kept for rollback
```

`<data>` is `%APPDATA%\Iblis\` unless you moved it in Settings, Data location.
Version folders never change after install; an update writes a new folder,
and rollback points `current.txt` back at the old one.

```
discovered -> downloaded -> verified -> installed -> active
                                            ^           |
                                            +- rolled back / removed
```

- **Host version gate.** The shell compares its own version with
  `hostMinVersion` before it installs, activates, starts, or rolls back to a
  version. A plugin that needs a newer shell is skipped with a message rather
  than started. Development runs (`just dev`) report version `0.0.0` and skip
  this gate.
- **Download queue.** Installs and updates share one first-in, first-out
  queue with progress, cancel, and a short history in Plugins, Downloads.
  Transfers resume after interruptions and verify size and hash on
  completion.
- **Hot-swap.** A sidecar plugin's new version starts on its own port and must
  pass its health check before the pointer flips and the old process stops.
  On failure the old version keeps running. See
  [architecture.md](architecture.md).
- **Supervision.** A crashed sidecar restarts automatically; more than three
  crashes in 60 seconds stop it and show the error.

## Capabilities

A capability is a tag such as `text-to-music`, `stem-split`, `bpm-detect`, or
`key-detect` (`KNOWN_CAPABILITIES` lists the common ones; any string is
allowed). Several plugins may declare the same capability, and the user picks
the default where the shell offers a choice: Settings, Audio analysis for BPM
and key providers, and the engine picker in Create for engines.

A processor that declares `bpm-detect` or `key-detect` must include an
`evaluation` block that states its code, model, and dependency licenses and
whether it may appear in the public catalog.

## The signed catalog

The catalog is a JSON document listing plugin versions:

```ts
interface Catalog {
  schemaVersion: number      // 1
  generatedAt: string        // ISO 8601
  plugins: { manifest: PluginManifest; channel?: 'stable' | 'beta'; publishedAt?: string }[]
}
```

It is served next to a detached signature:

- `https://iblis.meiuxmeiux.com/api/v2/catalog.json` and `catalog.json.sig`
  for current shells;
- the same pair under `/api/v1/` for older shells that do not understand
  cloud-provider plugins.

`catalog.json.sig` is the base64 Ed25519 signature over the exact bytes of
`catalog.json`. The shell:

1. downloads both files through the main process;
2. verifies the signature against the public key compiled into the app
   (`apps/shell/electron/main/keys/catalog.pub.pem`), before parsing;
3. parses the JSON with `parseCatalog`; any shape error in any entry rejects
   the whole catalog;
4. caches the last verified catalog so the Plugins view works offline.

A web server that is compromised cannot add or change a plugin without the
private key, which never leaves the maintainers' signing environment.

### Verify a catalog yourself

Save `catalog.json` and `catalog.json.sig` from one route into an empty
folder, then run:

```
just catalog-verify <folder>
```

It checks the signature against the same public key the app ships and
validates the shape with the SDK. The repository includes a snapshot you can
try it on: `just catalog-verify apps/shell/e2e/fixtures`.

## Publishing a plugin

Only the maintainers can sign the official catalog, so a plugin reaches users
through them:

1. Open an issue describing the plugin, its license, and any model weights
   and their licenses.
2. Add it under `packages/plugins/<name>/` with a `manifest.source.json` and
   the source of any sidecar, in a pull request.
3. The maintainers build and host the assets, add the plugin to the catalog,
   and sign it.

To test a plugin locally before that, build the shell yourself with your own
catalog: sign a catalog with your own Ed25519 key, replace
`catalog.pub.pem` with your public key, and point the app at your server with
the `IBLIS_CATALOG_BASE` environment variable (it replaces the whole
`.../api/v2` base). The E2E harness in `apps/shell/e2e/harness.ts` shows a
complete local catalog server.

## Rules for plugins

- No outbound network from sidecars. Downloads and hosted calls go through
  the shell.
- Bind only to `127.0.0.1` on the port the shell passes, and refuse any
  request without the `X-Iblis-Session` header.
- Read and write only inside the plugin's version folder and the paths the
  shell passes for a job.
- Start no processes other than the declared executable and its own
  children.
- No emojis in any user-visible string.
