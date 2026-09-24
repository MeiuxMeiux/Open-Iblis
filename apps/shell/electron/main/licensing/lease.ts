// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Entitlement-lease verification: base64url(payload-json).base64url(sig),
// Ed25519 over the exact payload bytes against the committed public key —
// the catalog.pub.pem pattern. Pure and fully unit-testable (the pubkey is
// an injectable default param). See docs/admin/01-product-keys.md.

import { createPublicKey, verify } from 'node:crypto'
import licensePubKeyPem from '../keys/license.pub.pem?raw'

const LICENSE_PUBKEY_PEM = licensePubKeyPem

// Signing key ids the verifier accepts; rotation ships an addition here
// before the server flips (01 doc, Keys and rotation).
const ACCEPTED_KIDS = ['lic-2026a']

export interface LeasePayload {
  v: number
  kid: string
  keyId: string
  installId: string
  fingerprint: string
  // Per-adapter fingerprint hashes the machine is bound to (H1 fix). Optional:
  // pre-fix leases omit it, and the client then falls back to the combined
  // fingerprint for its binding check.
  fp?: string[]
  features: string[]
  issuedAt: string
  leaseExpiresAt: string
  keyExpiresAt: string
}

function validPayload(p: unknown): p is LeasePayload {
  if (typeof p !== 'object' || p === null) return false
  const o = p as Record<string, unknown>
  return (
    o.v === 1 &&
    typeof o.kid === 'string' &&
    typeof o.keyId === 'string' &&
    typeof o.installId === 'string' &&
    typeof o.fingerprint === 'string' &&
    (o.fp === undefined || (Array.isArray(o.fp) && o.fp.every((h) => typeof h === 'string'))) &&
    Array.isArray(o.features) &&
    o.features.every((f) => typeof f === 'string') &&
    typeof o.issuedAt === 'string' &&
    typeof o.leaseExpiresAt === 'string' &&
    typeof o.keyExpiresAt === 'string'
  )
}

// Does this lease belong to the machine it is being read on? A lease copied
// to another box shares no network adapter with it and hashes to a different
// combined fingerprint, so it fails to bind and re-locks the gated surfaces
// even fully offline (H1 fix). Legit hardware drift (a dock, a VPN adapter, a
// single swapped NIC) keeps at least one adapter in common, so the machine
// stays bound. Pre-fix leases carry no `fp`; those fall back to the combined
// fingerprint, which tolerates no drift but is corrected on the next renewal.
export function leaseBindsToMachine(
  payload: LeasePayload,
  fingerprint: string,
  parts: string[]
): boolean {
  const bound = payload.fp
  if (bound !== undefined && bound.length > 0 && parts.length > 0) {
    const here = new Set(parts)
    return bound.some((h) => here.has(h))
  }
  return payload.fingerprint === fingerprint
}

// Signature + shape + kid only. Expiry and install binding are the
// service's judgment calls (a stale lease is still renewable; a fingerprint
// drift is re-activation, not rejection).
export function parseLease(
  lease: string,
  pubKeyPem: string = LICENSE_PUBKEY_PEM
): LeasePayload | null {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(lease)) return null
  const dot = lease.indexOf('.')
  const payloadBytes = Buffer.from(lease.slice(0, dot), 'base64url')
  const sig = Buffer.from(lease.slice(dot + 1), 'base64url')
  try {
    const key = createPublicKey(pubKeyPem)
    if (key.asymmetricKeyType !== 'ed25519') return null
    if (!verify(null, payloadBytes, key, sig)) return null
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadBytes.toString('utf8'))
  } catch {
    return null
  }
  if (!validPayload(parsed) || !ACCEPTED_KIDS.includes(parsed.kid)) return null
  return parsed
}

export function leaseExpiresAtMs(payload: LeasePayload): number {
  const t = Date.parse(payload.leaseExpiresAt)
  return Number.isNaN(t) ? 0 : t
}
