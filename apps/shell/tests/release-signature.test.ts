// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchReleaseSignature,
  installerFileName,
  parseReleaseSignature,
  RELEASE_SIGNATURE_DOMAIN,
  releaseSignatureMessage,
  releaseSignatureUrl,
  sha512Base64,
  verifyReleaseSignature,
  type ReleaseSignature
} from '../electron/main/release-signature'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
const otherPubPem = generateKeyPairSync('ed25519').publicKey.export({
  type: 'spki',
  format: 'pem'
}) as string
const rsaPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
  type: 'spki',
  format: 'pem'
}) as string

const VERSION = '0.2.0-alpha.54'
const SHA = Buffer.alloc(64, 7).toString('base64')

function signed(version = VERSION, sha512 = SHA): ReleaseSignature {
  const file = installerFileName(version)
  const sig = sign(null, releaseSignatureMessage(version, file, sha512), privateKey).toString(
    'base64'
  )
  return { version, file, sha512, sig }
}

describe('release signature format', () => {
  it('signs a domain-separated, newline-terminated message', () => {
    const msg = releaseSignatureMessage('1.0.0', 'Iblis-Setup-1.0.0.exe', 'abc=').toString('utf8')
    expect(msg).toBe(`${RELEASE_SIGNATURE_DOMAIN}\n1.0.0\nIblis-Setup-1.0.0.exe\nabc=\n`)
    expect(releaseSignatureUrl('https://feed/shell', '1.0.0')).toBe(
      'https://feed/shell/Iblis-Setup-1.0.0.exe.sig'
    )
  })

  it('parses only a well-formed v1 document', () => {
    const doc = signed()
    expect(parseReleaseSignature(JSON.stringify({ v: 1, ...doc }))).toEqual(doc)
    expect(parseReleaseSignature('not json')).toBeNull()
    expect(parseReleaseSignature('[]')).toBeNull()
    expect(parseReleaseSignature(JSON.stringify({ v: 2, ...doc }))).toBeNull()
    expect(parseReleaseSignature(JSON.stringify({ v: 1, ...doc, sig: '' }))).toBeNull()
    expect(
      parseReleaseSignature(JSON.stringify({ v: 1, ...doc, sha512: 'not base64!' }))
    ).toBeNull()
    expect(parseReleaseSignature(JSON.stringify({ v: 1, ...doc, file: 3 }))).toBeNull()
  })
})

describe('verifyReleaseSignature', () => {
  it('accepts the release key over the exact version, file, and sha512', () => {
    expect(verifyReleaseSignature(signed(), VERSION, SHA, pubPem)).toBeNull()
  })

  it('refuses another version, another file name, or other bytes', () => {
    expect(verifyReleaseSignature(signed(), '0.2.0-alpha.55', SHA, pubPem)).toMatch(
      /not 0.2.0-alpha.55/
    )
    expect(
      verifyReleaseSignature(
        { ...signed(), file: 'Iblis-Setup-0.2.0-alpha.54.msi' },
        VERSION,
        SHA,
        pubPem
      )
    ).toMatch(/names/)
    expect(
      verifyReleaseSignature(signed(), VERSION, Buffer.alloc(64, 8).toString('base64'), pubPem)
    ).toMatch(/do not match/)
  })

  it('refuses a forged or foreign signature and a non-Ed25519 key', () => {
    const doc = signed()
    const tampered = {
      ...doc,
      sig: Buffer.from(doc.sig, 'base64').fill(0, 0, 4).toString('base64')
    }
    expect(verifyReleaseSignature(tampered, VERSION, SHA, pubPem)).toBe(
      'release signature does not verify'
    )
    expect(verifyReleaseSignature(doc, VERSION, SHA, otherPubPem)).toBe(
      'release signature does not verify'
    )
    expect(verifyReleaseSignature(doc, VERSION, SHA, rsaPem)).toBe(
      'release public key is not Ed25519'
    )
    expect(verifyReleaseSignature(doc, VERSION, SHA, 'garbage')).toMatch(/check failed/)
  })
})

describe('fetchReleaseSignature', () => {
  afterEach(() => vi.unstubAllGlobals())

  const respond = (status: number, body: string): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(body, { status, statusText: status === 200 ? 'OK' : 'Not Found' })
      )
    )
  }

  it('returns the parsed document, a missing marker for 404, and an error otherwise', async () => {
    const doc = signed()
    respond(200, JSON.stringify({ v: 1, ...doc }))
    expect(await fetchReleaseSignature('https://feed/shell', VERSION)).toEqual({
      kind: 'ok',
      signature: doc
    })
    respond(404, '')
    expect(await fetchReleaseSignature('https://feed/shell', VERSION)).toEqual({ kind: 'missing' })
    respond(200, '{"v":1}')
    expect(await fetchReleaseSignature('https://feed/shell', VERSION)).toEqual({
      kind: 'error',
      message: 'release signature is malformed'
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    expect(await fetchReleaseSignature('https://feed/shell', VERSION)).toEqual({
      kind: 'error',
      message: 'Error: offline'
    })
  })
})

describe('sha512Base64', () => {
  it('hashes file bytes the way latest.yml records them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'iblis-sig-'))
    const path = join(dir, 'installer.bin')
    writeFileSync(path, Buffer.from('iblis'))
    const { createHash } = await import('node:crypto')
    expect(await sha512Base64(path)).toBe(createHash('sha512').update('iblis').digest('base64'))
    await expect(sha512Base64(join(dir, 'missing'))).rejects.toThrow()
  })
})
