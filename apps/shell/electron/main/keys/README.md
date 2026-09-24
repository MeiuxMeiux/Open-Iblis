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
