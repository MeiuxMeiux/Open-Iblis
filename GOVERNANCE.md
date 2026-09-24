# Governance

## Who runs the project

Iblis is maintained by Meiux Meiux LLC. The company owns the project, the
trademarks, the signing keys, and the hosted service, and appoints the
maintainers. Today the maintainer team is small; new maintainers may be
invited from regular contributors.

Maintainers:

- review and merge pull requests (see "How changes land" below);
- triage issues and the feedback that arrives through the website form;
- cut official releases and publish plugin packs to the signed catalog;
- enforce the [Code of Conduct](CODE_OF_CONDUCT.md);
- manage repository settings: branch protection, required checks, secret
  scanning and push protection, private vulnerability reporting, Dependabot
  alerts, and CodeQL code scanning.

## How changes land

This repository is a published snapshot of the maintainers' repository, which
also holds the private server code and release pipeline. Pull requests are
reviewed here. An approved pull request is applied upstream with its original
author and `Signed-off-by` lines, and appears here in the next sync; the
maintainer then closes the pull request with a link to that sync.
[CONTRIBUTING.md](CONTRIBUTING.md) describes the details.

At least one maintainer approves every change. Changes to a public contract
(the plugin manifest, skin tokens, the engine contract, catalog format) need
a written rationale in the pull request and matching documentation updates.

## Decisions

- Day-to-day technical decisions happen in issues and pull requests.
- Larger or contested decisions are written down in an issue labeled
  `decision`, with the options considered and the outcome, and linked from
  the change that implements them. Changes to a public contract always get
  such a record.
- If consensus cannot be reached, Meiux Meiux LLC makes the final call and
  records the reason in the same issue.

## Releases

- Official builds are cut from `main` as numbered alphas
  (`0.2.0-alpha.N`) when there is a user-facing change worth shipping,
  typically several times a month during the alpha.
- Installers are built, signed where signing is available, and published by
  the maintainers' release pipeline. The app updates itself from that feed.
- Plugin packs (engines, the trainer, skins, cloud adapters) ship through the
  signed catalog on their own schedule, independent of app releases.
- Release notes list user-facing changes. [docs/releases.md](docs/releases.md)
  explains official versus source builds.

## Licensing and contributions

Contributions are accepted under the license of the files they change and the
[Developer Certificate of Origin](https://developercertificate.org/). There is
no CLA and no copyright assignment. Meiux Meiux LLC does not plan a closed
version of the desktop app; if that ever changes, it would need contributors'
permission for their code, and this document would say so first.

## Changes to this document

Changes to governance are made by pull request and approved by Meiux Meiux
LLC.
