# Shipped public verification keys

`catalog.pub.pem` is the **public** Ed25519 key the shell uses to verify the
signed plugin catalog (`api/v1/catalog.json` + `catalog.json.sig`). It is safe
to commit and ship inside the installer — verification only.

The matching **private** key is held only by the release operator, outside
any repository, and is never committed. It signs the catalog at publish time.

- Generated: 2026-06-03, Ed25519 (`openssl genpkey -algorithm ed25519`).
- Pubkey DER SHA-256 fingerprint:
  `817d034ebdf510beca72bbddc22348420fbdb312a442fbea1b3bd368a90eb531`

To re-derive the public key from the private key (sanity check):

```
openssl pkey -in <catalog-signing.key> -pubout
```

If the private key is ever rotated, replace `catalog.pub.pem` here, re-sign
every published catalog, and ship a shell update before old clients reject the
new signature.

## license.pub.pem

`license.pub.pem` is the **public** Ed25519 key the shell uses to verify
product-key entitlement leases. Same posture: safe to commit, verification
only.

The matching private key lives only on the entitlement server, which signs
leases during product-key activation. Never committed.

- Generated: 2026-07-14, Ed25519.
- Pubkey DER SHA-256 fingerprint:
  `95602c5e94d76318a857a1f029b768e10ed9b7b4123684f9d146485fe7d46d4c`
- Rotation is routine: add the new `kid` to the shell verifier, ship,
  flip signing, retire the old key after one lease TTL (7 days).

## release.pub.pem

`release.pub.pem` is the **public** Ed25519 key the shell uses to verify shell
installers before an auto-update downloads or installs them
(`electron/main/release-signature.ts`). Same posture: safe to commit,
verification only.

The matching private key is held only by the release operator, outside any
repository and outside CI: `scripts/release-sign.sh` (via `just release-sync`)
signs each tagged installer's sha512 after CI publishes it and uploads the
signature beside the installer. CI can build and upload an installer, but no
installed app accepts one this key has not signed.

- Generated: 2026-09-25, Ed25519 (`openssl genpkey -algorithm ed25519`).
- Pubkey DER SHA-256 fingerprint:
  `8a934ed1162700789bdbb2a061163b90a12e16d2cfcdee2b762584cafc866fca`
- Rotation: ship a shell release whose verifier accepts both keys, flip the
  signing key, then drop the old key one release later. Installed apps only
  ever verify with the key their own build carries, so never rotate in a
  single step.
