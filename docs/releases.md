# Releases: official and source builds

## Official builds

Official installers are built by the maintainers' release pipeline, which
runs in a private repository alongside the server code and signing keys. The
source it builds is the same tree published here: this repository is exported
from that one, and each official release is built from an exported commit.

- **Versions** are numbered alphas, `0.2.0-alpha.N`. Release notes are on
  <https://iblis.meiuxmeiux.com/changelog>.
- **Download** from <https://iblis.meiuxmeiux.com/download>.
- **Updates** arrive automatically. The app reads the official update feed at
  launch, periodically while it is in the foreground, and when you press
  Check now in Settings, Updates. The feed lists the installer and its
  SHA-512; the updater refuses a download that does not match.
- **Code signing** of the Windows installer is being arranged; until it is in
  place, Windows SmartScreen may warn on first install.
- **Plugins** (the engine pack, the training pack, skins, cloud adapters)
  have their own versions and ship through the signed catalog, independent of
  app releases.

## Source builds

A build you make with `just dev`, `just build`, or `just dist` runs the same
code. The differences are about distribution, not features:

| | Official build | Source build |
| --- | --- | --- |
| Built by | Maintainers' release pipeline | You |
| Code signature | Planned | None |
| Auto-update | Yes, from the official feed | No; rebuild from a newer commit |
| Plugin catalog | Official signed catalog | Official signed catalog |
| Label in Settings | Official build | Source build |
| Support | Yes | Best effort; say "Source build" in reports |

A fork that distributes its own builds must use its own name, app id, and
update feed; see [TRADEMARKS.md](../TRADEMARKS.md).

## Matching an official version to a public commit

Planned: the official release job will record the Git tree hash of the
exported source it built from, and publish it with the release notes. Anyone
can then find the public commit with the same tree:

```
git rev-parse <commit>^{tree}
```

The two hashes match when the release was built from exactly that source.
This proves which source a release came from; it does not yet prove that the
installer bytes are reproducible from it. Reproducible installers and signed
build provenance are longer-term goals.

## Release cadence

Alphas ship when there is a user-facing change worth shipping, often several
times a month. Security fixes ship as soon as they are ready, and only the
latest alpha is supported ([SECURITY.md](../SECURITY.md)).
