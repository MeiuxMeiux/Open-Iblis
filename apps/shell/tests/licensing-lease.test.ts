// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Lease verification vectors: authentic, tampered, wrong key, bad kid,
// malformed. Ephemeral Ed25519 keypairs — the real private key never
// appears in tests (docs/admin/03-shell-integration.md §Rollout safety).
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { parseLease, leaseExpiresAtMs, type LeasePayload } from '../electron/main/licensing/lease'
import { payloadFixture, signLease, testPrivateKey, testPubPem } from './licensing-fixtures'

const otherKeys = generateKeyPairSync('ed25519')

describe('parseLease', () => {
  it('accepts an authentic lease and returns the payload', () => {
    const lease = signLease(payloadFixture())
    const parsed = parseLease(lease, testPubPem)
    expect(parsed).not.toBeNull()
    expect(parsed?.keyId).toBe('01TESTKEY')
    expect(leaseExpiresAtMs(parsed!)).toBe(Date.parse('2026-07-21T12:00:00Z'))
  })

  it('rejects a tampered payload (signature over exact bytes)', () => {
    const lease = signLease(payloadFixture())
    const dot = lease.indexOf('.')
    const p64 = lease.slice(0, dot)
    const s64 = lease.slice(dot + 1)
    const tampered = JSON.parse(Buffer.from(p64, 'base64url').toString()) as LeasePayload
    tampered.keyExpiresAt = '2036-01-01T00:00:00Z'
    const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${s64}`
    expect(parseLease(forged, testPubPem)).toBeNull()
  })

  it('rejects a lease signed by the wrong key', () => {
    const lease = signLease(payloadFixture(), otherKeys.privateKey)
    expect(parseLease(lease, testPubPem)).toBeNull()
  })

  it('rejects an unknown kid even with a valid signature', () => {
    const lease = signLease(payloadFixture({ kid: 'lic-9999x' }))
    expect(parseLease(lease, testPubPem)).toBeNull()
  })

  it('rejects malformed input without throwing', () => {
    for (const junk of ['', 'x', 'a.b.c', '!!.!!', `${'A'.repeat(10)}.${'B'.repeat(10)}`]) {
      expect(parseLease(junk, testPubPem)).toBeNull()
    }
  })

  it('rejects a structurally wrong payload', () => {
    const bytes = Buffer.from(JSON.stringify({ v: 2, hello: 'world' }))
    const sig = sign(null, bytes, testPrivateKey)
    const lease = `${bytes.toString('base64url')}.${sig.toString('base64url')}`
    expect(parseLease(lease, testPubPem)).toBeNull()
  })
})
