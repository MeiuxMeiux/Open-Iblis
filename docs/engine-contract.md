# Engine contract

An engine is a plugin of kind `engine` whose sidecar turns a request into
audio. This document describes how the shell finds, starts, and talks to
engines. The types and strict parsers are in `@iblis/plugin-sdk`:
`engine-v2.ts` (descriptor) and `engine-v2-jobs.ts` (recipe, job state,
outputs).

## Two drivers, one registry

The shell's engine registry (`apps/shell/electron/main/engine/`) routes each
installed engine to a driver:

- **v2 driver.** For any manifest with an `engine` section
  (`protocolVersion: 2`). This is the contract new engines implement, and the
  rest of this document describes it.
- **ACE compatibility driver.** For the shipped ACE-Step engine pack, which
  runs the upstream `acestep.cpp` server unmodified. The driver speaks that
  server's own HTTP dialect (`/props`, `/lm`, `/synth`, `/job`). It is not a
  contract for new engines and will be retired once ACE-Step ships as a v2
  pack.

Shared code (the queue, the library, IPC) only sees the registry's provider
interface, never an engine-specific protocol.

Engines today: ACE-Step 1.5 through `acestep.cpp` (compatibility driver), and
`fixture-engine`, a tiny test engine that proves the v2 path end to end.
`audio.cpp` is planned as the next runtime, delivered as a v2 engine pack.

## Manifest section

```json
"engine": {
  "protocolVersion": 2,
  "descriptorAsset": "engine.v2.json",
  "execution": "local-sidecar"
}
```

- `descriptorAsset` names an asset of the same manifest. It is the
  **signed descriptor**: pinned by SHA-256 through the catalog, so it states
  the most the engine may ever claim.
- `execution` is `local-sidecar`; no other value is accepted.
- `adapterIngress` (optional, `"iblis-root-v1"`) reserves a standard way to
  hand Styles to an engine. It is not active yet: a v2 engine currently
  receives no adapters.

The manifest also needs an `executable` block ([plugins.md](plugins.md)).
`idleUnloadMinutes` controls how long a warm engine stays loaded.

## Descriptor

```ts
interface EngineDescriptorV2 {
  protocolVersion: 2
  engineFamily: string          // scopes adapters and model claims
  models: { id: string; revision: string }[]
  profiles: { id: string; label: string; modelId: string }[]
  phases: string[]              // progress phase ids, e.g. ["prime", "sketch", "varnish"]
  operations: EngineOperationV2[]
}

interface EngineOperationV2 {
  id: 'music.generate' | 'music.cover' | 'music.extend' | 'music.inpaint'
    | 'music.complete' | 'music.add-layer' | 'music.extract-layer'
  inputs: { role: 'source' | 'reference'; required: boolean;
            formats: ('wav' | 'flac' | 'mp3')[]; maxDurationSec: number; maxRanges: number }[]
  prompt: { required: boolean; maxBytes: number } | null
  lyrics: { dialect: 'plain' | 'ace-structured'; maxBytes: number } | null
  duration: { minSec: number; maxSec: number } | null
  outputs: { role: 'mix' | 'vocals' | 'accompaniment' | 'layer' | 'residual'
             | 'preview' | 'metadata'; maxCount: number }[]
  commonControls: ('negativePrompt' | 'bpm' | 'keyscale' | 'timeSignature')[]
  advancedControls: EngineAdvancedControlV2[]  // boolean, number, integer, or enum
  profileIds: string[]
  adapters: { families: string[]; maxActive: number } | null
  seed: 'none' | 'uint32'
  cancellation: boolean
}
```

Every shape is closed. Unknown fields, unbounded text, and out-of-range
numbers fail in the shell before any request reaches the engine. Limits are
constants in `engine-v2.ts` (for example 128 KiB per descriptor, 16
operations, 32 advanced controls). Advanced controls carry a label and
optional help text, which the shell renders with its own components; an
engine cannot supply HTML, scripts, URLs, or file pickers.

`packages/plugins/fixture-engine/engine.v2.json` is a complete, valid
descriptor.

The current shell runs the `music.generate` operation. The other operation
ids are defined so engines can declare them; the shell will offer them as the
Create screen grows.

## Wire protocol

The sidecar serves HTTP on `127.0.0.1` at the port given by `--port` (or the
manifest's `portArg`). Every request carries `X-Iblis-Session` with the value
of the `IBLIS_SESSION` environment variable (or the manifest's `sessionEnv`);
the sidecar must refuse anything else.

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /health` | - | 200 once ready |
| `GET /v2/descriptor` | - | The live `EngineDescriptorV2` |
| `POST /v2/jobs` | `{ "recipe": EngineRecipeV2, "staging": "<absolute dir>" }` | `{ "jobId": "<id>" }` |
| `GET /v2/jobs/<jobId>` | - | `EngineJobStateV2` |
| `POST /v2/jobs/<jobId>/cancel` | `{}` | 200 |

### Live descriptor narrowing

`GET /v2/descriptor` reports what the installed engine can do right now, for
example which model revisions are present. It may remove or narrow what the
signed descriptor claims; it may never add or widen anything. The shell
checks this with `engineDescriptorNarrowingErrorsV2` and refuses an engine
whose live descriptor goes beyond its signed one.

### Recipe

```ts
interface EngineRecipeV2 {
  protocolVersion: 2
  operation: EngineOperationIdV2
  providerId: string            // plugin id
  pluginVersion: string
  descriptorHash: string        // SHA-256 of the signed descriptor bytes
  profileId: string
  prompt?: string
  lyrics?: string
  inputs: { role: 'source' | 'reference'; artifactId: string;
            range?: { startSec: number; endSec: number } }[]
  targetDurationSec?: number
  regions?: { startSec: number; endSec: number }[]
  common?: { negativePrompt?: string; bpm?: number; keyscale?: string; timeSignature?: string }
  advanced?: Record<string, boolean | number | string>
  adapters?: { libraryId: string; scale: number }[]
  seed?: number
}
```

The recipe holds ids, never file paths. The shell validates it against the
descriptor (`engineRecipeErrorsV2`) when the job is queued and again just
before it is sent. `staging` is a fresh, job-specific directory that the
shell creates; it is the only place the engine may write.

### Job state

```ts
interface EngineJobStateV2 {
  protocolVersion: 2
  jobId: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  progress: number              // 0..1
  phase?: string                // one of the descriptor's phases
  error?: { code: string; message: string }
  outputs?: { role: EngineOutputRoleV2; path: string }[]  // relative to staging
}
```

The shell polls until the job ends. Error codes and messages are bounded
plain text; raw model logs never reach the user interface.

### Outputs

When a job is `done`, the shell:

1. checks every output path with `engineOutputPathErrorsV2` and resolves it
   inside `staging`, rejecting absolute paths, `..`, and links;
2. reads each file with a size cap and parses it as WAV;
3. imports the `mix` output as a new library track, and keeps a `preview`
   output beside it;
4. records the engine id, version, descriptor hash, recipe, and phase timings
   in the track's `generation.json`;
5. deletes the staging directory, whether the job succeeded, failed, or was
   cancelled.

A job without a `mix` output fails.

## Lifecycle and scheduling

- **On demand.** v2 engines never start at app launch or at install. The
  shell starts the selected engine when a job needs it, keeps it warm, and
  stops it after `idleUnloadMinutes` without work.
- **One GPU owner.** One heavy job runs at a time. Training stops the engine
  and blocks generation until it finishes.
- **Defaults per operation.** The default engine for each operation is stored
  in `engine-defaults.json`. Create shows an engine picker when more than one
  engine is installed.
- **Exact targeting.** When a job is queued, the shell records the plugin id,
  version, protocol, and descriptor hash. The job runs on exactly that
  engine or fails with a clear message; installing, updating, or switching
  engines never redirects work that is already queued.
- **Supervision.** A crashing engine restarts; more than three crashes in 60
  seconds stop it and show the error.

## Rules for engine sidecars

- Bind only to `127.0.0.1` and refuse requests without the session header.
- Make no network requests. Model files arrive as plugin assets.
- Write only inside the job's `staging` directory and the plugin's own
  version folder.
- Keep the live descriptor within the signed one.
- Keep responses small and bounded; report progress as a number from 0 to 1.

## Testing an engine

`packages/plugins/fixture-engine/src/fixture-engine.cjs` is a zero-dependency
Node implementation of the whole protocol. It writes a synthesized WAV and
has hostile modes (a widened live descriptor, an output path outside
staging, forced errors) that the shell's tests use to prove it refuses them.
Start from it when writing a new engine adapter. The shell's unit tests
(`just test`) and the Create E2E spec (`just e2e`) run against it.
