# echo-server (stub plugin)

The Phase 2 proof plugin. It is **not** a real engine — it exists so the
plugin host can be exercised end-to-end with no audio stack: install, spawn,
health-check, hot-swap, roll back, remove, all through the shell UI.

It is a zero-dependency Node sidecar (`src/echo-server.cjs`). Because it is a
script rather than a compiled binary, the whole host loop runs on any dev box
(Linux/macOS/Windows) without ACE-Step or CUDA.

## Endpoints

Binds `127.0.0.1:<port>` only. Every request must carry
`X-Iblis-Session: <secret>` matching the `IBLIS_SESSION` env var the shell
sets per session (drive-by localhost requests get `401`).

| Method | Path      | Response                                  |
| ------ | --------- | ----------------------------------------- |
| GET    | `/health` | `{ ok, name, version }`                   |
| POST   | `/echo`   | `{ echo: <parsed body>, receivedAt }`     |

`/health`'s `version` is bumped per release, so a successful hot-swap is
visible: `0.1.0` -> `0.1.1` proves the supervisor swapped the live process.

## Run it by hand

```bash
IBLIS_SESSION=dev node src/echo-server.cjs --port 8799
curl -H 'X-Iblis-Session: dev' http://127.0.0.1:8799/health
curl -H 'X-Iblis-Session: dev' -d '{"hi":1}' http://127.0.0.1:8799/echo
```

## How it ships

`manifest.source.json` is the authoring template. The maintainers' catalog
build (`just catalog-build`, which needs the signing key and is not part of
the public repository) reads it, hashes each asset's `file`, and emits a
verified signed candidate under
`.catalog-stage/` (asset `path` + `sha256` + `bytes`, with `file` stripped).
`just catalog-publish` uploads/verifies the bytes before promoting that entry.
The shell installs the hashed asset under the plugin's versioned AppData path.
