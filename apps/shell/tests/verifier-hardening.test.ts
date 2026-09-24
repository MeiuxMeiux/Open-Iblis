// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Security audit 2026-09-24: signature verifiers accept only Ed25519 keys
// (I-SHL12), and nvidia-smi is never resolved from the current directory on
// Windows (L-SHL11).
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyCatalogSignature } from '../electron/main/catalog/verify'
import { nvidiaSmiCommand } from '../electron/main/hardware'

describe('verifyCatalogSignature key type', () => {
  it('accepts an Ed25519 signature and refuses a key of another type', () => {
    const bytes = Buffer.from('{"plugins":[]}')
    const ed = generateKeyPairSync('ed25519')
    const edPem = ed.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const edSig = sign(null, bytes, ed.privateKey).toString('base64')
    expect(verifyCatalogSignature(bytes, edSig, edPem)).toBe(true)

    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const rsaPem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const rsaSig = sign('sha256', bytes, rsa.privateKey).toString('base64')
    expect(verifyCatalogSignature(bytes, rsaSig, rsaPem)).toBe(false)
  })
})

describe('nvidiaSmiCommand', () => {
  it('uses the bare name off Windows', () => {
    expect(nvidiaSmiCommand('linux', {}, () => false)).toBe('nvidia-smi')
  })

  it('resolves an absolute driver path on Windows, never the bare name', () => {
    const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }
    const system32 = nvidiaSmiCommand('win32', env, (p) => p.includes('System32'))
    expect(system32).toMatch(/System32.nvidia-smi\.exe$/)
    const nvsmi = nvidiaSmiCommand('win32', env, (p) => p.includes('NVSMI'))
    expect(nvsmi).toMatch(/NVSMI.nvidia-smi\.exe$/)
    expect(nvidiaSmiCommand('win32', env, () => false)).toBeNull()
  })
})
