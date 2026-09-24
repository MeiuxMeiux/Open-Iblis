// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { verify, createPublicKey } from 'node:crypto'
import catalogPubKeyPem from '../keys/catalog.pub.pem?raw'

// Ed25519 verification of the catalog bytes against the baked-in public key.
// This is the trust root: the shell reads no catalog entry whose signature
// does not verify here. The private half never leaves Jack / a CI secret.
// (Ed25519 in node:crypto uses algorithm `null`.)

const CATALOG_PUBKEY_PEM = catalogPubKeyPem

export function verifyCatalogSignature(
  bytes: Buffer,
  signatureBase64: string,
  pubKeyPem: string = CATALOG_PUBKEY_PEM
): boolean {
  try {
    const sig = Buffer.from(signatureBase64.trim(), 'base64')
    const key = createPublicKey(pubKeyPem)
    // verify(null, ...) picks the algorithm from the key, so pin the type: a
    // build-injected key of another type must never be accepted (audit
    // 2026-09-24, I-SHL12).
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, bytes, key, sig)
  } catch {
    return false
  }
}
