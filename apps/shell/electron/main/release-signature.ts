// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash, createPublicKey, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { fetchText } from './catalog/fetch'
import releasePubKeyPem from './keys/release.pub.pem?raw'

// Release signatures for shell installers (audit 2026-09-24, H-SUP1).
//
// The update feed (latest.yml + installer) lives in a bucket that CI writes.
// Anyone holding that credential could ship code, so the shell trusts an
// installer only when an offline Ed25519 release key, held by the release
// operator and never in CI, has signed its sha512. The signature is a small
// JSON document published next to the installer as `<installer>.sig`:
//
//   { "v": 1, "version": "...", "file": "Iblis-Setup-....exe",
//     "sha512": "<base64, as in latest.yml>", "sig": "<base64 Ed25519>" }
//
// `sig` covers the canonical message below, never the JSON itself, so the
// operator's script and this verifier agree byte for byte. scripts/release-sign.sh
// produces the document; the private key never leaves the release operator's box.

export const RELEASE_SIGNATURE_DOMAIN = 'iblis-shell-release/1'

export interface ReleaseSignature {
  version: string
  file: string
  sha512: string
  sig: string
}

export type SignatureLookup =
  | { kind: 'ok'; signature: ReleaseSignature }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

export function installerFileName(version: string): string {
  return `Iblis-Setup-${version}.exe`
}

export function releaseSignatureUrl(feed: string, version: string): string {
  return `${feed}/${installerFileName(version)}.sig`
}

// The exact bytes the release key signs.
export function releaseSignatureMessage(version: string, file: string, sha512: string): Buffer {
  return Buffer.from(`${RELEASE_SIGNATURE_DOMAIN}\n${version}\n${file}\n${sha512}\n`, 'utf8')
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

function str(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

export function parseReleaseSignature(text: string): ReleaseSignature | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const doc = raw as Record<string, unknown>
  if (doc.v !== 1) return null
  const { version, file, sha512, sig } = doc
  if (!str(version) || !str(file) || !str(sha512) || !str(sig)) return null
  if (!BASE64.test(sha512) || !BASE64.test(sig)) return null
  return { version, file, sha512, sig }
}

// null when the document is a valid signature by the release key for exactly
// this version and installer hash; otherwise the reason it is refused.
export function verifyReleaseSignature(
  signature: ReleaseSignature,
  expectedVersion: string,
  fileSha512Base64: string,
  pubKeyPem: string = releasePubKeyPem
): string | null {
  if (signature.version !== expectedVersion) {
    return `release signature is for ${signature.version}, not ${expectedVersion}`
  }
  if (signature.file !== installerFileName(expectedVersion)) {
    return `release signature names ${signature.file}, not the installer`
  }
  if (signature.sha512 !== fileSha512Base64) {
    return 'installer bytes do not match the signed sha512'
  }
  try {
    const key = createPublicKey(pubKeyPem)
    // Pin the key type: verify(null, ...) would otherwise accept whatever a
    // swapped key file says it is (audit 2026-09-24, I-SHL12).
    if (key.asymmetricKeyType !== 'ed25519') return 'release public key is not Ed25519'
    const message = releaseSignatureMessage(signature.version, signature.file, signature.sha512)
    const ok = verify(null, message, key, Buffer.from(signature.sig, 'base64'))
    return ok ? null : 'release signature does not verify'
  } catch (error) {
    return `release signature check failed: ${String(error)}`
  }
}

// Fetch the signature published beside the installer. `missing` is the
// normal state for the minutes between CI publishing latest.yml and the
// operator signing the release; the updater then waits for the next check.
export async function fetchReleaseSignature(
  feed: string,
  version: string
): Promise<SignatureLookup> {
  try {
    const text = await fetchText(releaseSignatureUrl(feed, version), {
      'cache-control': 'no-cache'
    })
    const signature = parseReleaseSignature(text)
    if (signature === null) return { kind: 'error', message: 'release signature is malformed' }
    return { kind: 'ok', signature }
  } catch (error) {
    const message = String(error)
    if (/\b404\b/.test(message)) return { kind: 'missing' }
    return { kind: 'error', message }
  }
}

// Streamed so a 100+ MB installer never sits in memory. Base64 matches the
// encoding electron-updater uses in latest.yml.
export function sha512Base64(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
  })
}
