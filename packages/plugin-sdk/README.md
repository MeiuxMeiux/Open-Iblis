# @iblis/plugin-sdk

The contracts that hold Iblis together, as TypeScript types plus
zero-dependency runtime validators. The desktop app imports it to discover,
verify, and load plugins; plugin authors use it to write manifests, skins, and
engine descriptors against typed shapes. Nothing in the exported surface
depends on Electron or Node-only APIs.

Licensed Apache-2.0 ([LICENSE](LICENSE)). Plugins built against the SDK may
use any license.

## Modules

| Module              | Contract                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| `manifest.ts`       | `PluginManifest`: id, kind, assets pinned by SHA-256, sidecar executable |
| `validate.ts`       | `parseManifest`, `parseCatalog`, `parseSkinDescriptor`                   |
| `catalog.ts`        | The signed catalog shape                                                 |
| `skin-contract.ts`  | `SKIN_TOKENS`, the closed design-token list, and `tokenToCssVar`         |
| `engine-v2.ts`      | Engine contract v2 descriptor and `parseEngineDescriptorV2`              |
| `engine-v2-jobs.ts` | Recipes, job state, outputs, and the live-descriptor narrowing rule      |
| `engine.ts`         | The v1 engine request types and the `X-Iblis-Session` header name        |
| `processor.ts`      | Normalized BPM and key results for analysis providers                    |
| `capabilities.ts`   | Known capability tags (`text-to-music`, `bpm-detect`, ...)               |
| `slots.ts`          | Reserved UI slot names (not loaded by the current app)                   |

Guides: [plugins](../../docs/plugins.md), [skins](../../docs/skins.md),
[engine contract](../../docs/engine-contract.md). Changing a contract here
means updating its guide in the same pull request.

## Validation is a trust boundary

The catalog is Ed25519-signed, but its JSON is still parsed defensively: a
valid signature over malformed data must never crash the app. Every parser
collects readable errors with field paths instead of throwing:

```ts
import { parseManifest } from '@iblis/plugin-sdk'

const result = parseManifest(JSON.parse(text))
if (result.ok) {
  console.log(result.value.id, result.value.kind)
} else {
  console.error(result.errors.join('\n'))
}
```

Signature checks live in the app, which holds the public key; this package
defines the shapes.

## Develop

From the repository root:

```
just sdk-build    # compile to dist/ (ESM + .d.ts)
just sdk-docs     # API reference in api-docs/ (TypeDoc)
just test         # includes this package's Vitest suite
just lint         # includes ESLint + Prettier for this package
```
