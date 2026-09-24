// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared lease-signing fixtures for the licensing tests. Ephemeral Ed25519
// keypair — the real signing key never appears anywhere near tests.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type { LeasePayload } from '../electron/main/licensing/lease'

const pair = generateKeyPairSync('ed25519')
export const testPrivateKey: KeyObject = pair.privateKey
export const testPubPem: string = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()

export function payloadFixture(overrides: Partial<LeasePayload> = {}): LeasePayload {
  return {
    v: 1,
    kid: 'lic-2026a',
    keyId: '01TESTKEY',
    installId: 'a'.repeat(64),
    fingerprint: 'b'.repeat(64),
    fp: ['p1'],
    features: ['training', 'generation', 'styles-community'],
    issuedAt: '2026-07-14T12:00:00Z',
    leaseExpiresAt: '2026-07-21T12:00:00Z',
    keyExpiresAt: '2026-08-13T12:00:00Z',
    ...overrides
  }
}

export function signLease(payload: LeasePayload, key: KeyObject = testPrivateKey): string {
  const bytes = Buffer.from(JSON.stringify(payload))
  const sig = sign(null, bytes, key)
  return `${bytes.toString('base64url')}.${sig.toString('base64url')}`
}
