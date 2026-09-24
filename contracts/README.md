# Wire-contract fixtures

Golden files shared by the code on each side of a wire contract. Each
producer's tests reproduce the committed bytes exactly, and each consumer's
tests accept those same bytes. A change that breaks the other side then fails
in one of the two suites, not in the field.

| Contract | Produced by | Consumed by | Files |
| --- | --- | --- | --- |
| Entitlement lease | server `Keys\Lease::issue` | shell `licensing/lease.ts` | `lease/` |
| Trainings index | server `Trainings\Index::render`, signed by `tools/catalog/sign.cjs` | shell `styles/trainings-index.ts` | `trainings/` |
| Diagnostics upload | shell `diag/bundle.ts`, `diag/index.ts` | server `Diag\Bundle::problem` | `diag/` |
| Safetensors verdicts | (a mirror, not a producer) | shell `adapters/safetensors.ts`, server `Trainings\Safetensors`, trainer `stages/export.py` | `safetensors/cases.json` |
| Feedback form | the `/feedback` web form (the app only opens its URL) | server `Feedback\Validator`, stored by `Feedback\Registry` | `feedback/` |
| Plugin catalog | `tools/catalog` build + sign | shell `catalog/`, SDK `parseCatalog` | `apps/shell/e2e/fixtures/catalog.json` (the live signed feed, verbatim) |

Tests that read these files:

- `apps/shell/tests/contract-fixtures.test.ts` (shell, Vitest)
- `apps/site/tests/ContractFixturesTest.php` (server, PHPUnit)
- `tools/catalog/contracts.test.cjs` (signing tool, node:test)
- `packages/plugins/acestep-training/tests/test_contracts.py` (trainer, unittest)

## Signing key

Signed fixtures use an Ed25519 key whose seed is
`sha256("iblis contract fixtures: test-only signing seed")`. The seed is
public, so nothing it signs is trusted anywhere else. The shell's production
public keys reject these fixtures, and a test checks that.

## Changing a contract

Inputs (`lease/inputs.json`, `trainings/registry.json`, `diag/*.json`,
`safetensors/cases.json`, `feedback/submission.json`) are edited by hand. A safetensors case is either
`raw` (the whole file in hex) or a `header` (or `headerBase64`) written as
u64le length, header padded with spaces to `padTo`, then `dataBytes` zero
bytes; `reason` optionally pins part of the refusal message. The server's golden outputs (`lease/lease.txt`,
`lease/payload.json`, `trainings/index.json`, `trainings/index.json.sig`,
`feedback/record.json`) are regenerated with `just contracts-regen`.

`feedback/submission.json` is the canonical accepted form body. Its `ts`
field is the form's signed fill-time stamp, made with the public fixture
secret `sha256("iblis contract fixtures: feedback form secret")` (hex) at
`1800000000 - 60`; the test fails with "ts is stale" if the stamp format
changes. `feedback/record.json` is what the registry stores for it, minus the
salted client-address hash, which never leaves the server. Review the diff: every changed byte
is a change on the wire, and the shell tests must still pass without edits
unless the change is meant to break old consumers.
