// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict'
// Ed25519 over the exact catalog.json bytes. The private key never leaves the
// signing host (or a scoped CI secret); the public half is baked into the shell.
// Ed25519 in node:crypto uses algorithm `null`.
const { sign, verify, createPrivateKey, createPublicKey } = require('node:crypto')
const { readFileSync } = require('node:fs')

function signBytes(bytes, keyPath) {
  const key = createPrivateKey(readFileSync(keyPath))
  return sign(null, bytes, key).toString('base64')
}

function verifyBytes(bytes, sigBase64, pubKeyPem) {
  const sig = Buffer.from(sigBase64.trim(), 'base64')
  return verify(null, bytes, createPublicKey(pubKeyPem), sig)
}

module.exports = { signBytes, verifyBytes }
