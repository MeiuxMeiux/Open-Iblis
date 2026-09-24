// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict'
// Verify a signed catalog the way the shell will: Ed25519 over the exact
// catalog.json bytes against the committed public key, then re-validate the
// shape through the SDK. Exits non-zero on any failure — handy as a prod /
// pre-deploy gate that the live api/v1/catalog.json is intact.
//
//   node tools/catalog/verify-catalog.cjs [--dir apps/site/public/api/v1]
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { readFileSync } = require('node:fs')
const { verifyBytes } = require('./sign.cjs')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const PUBKEY = path.join(REPO_ROOT, 'apps/shell/electron/main/keys/catalog.pub.pem')

function parseDir(argv) {
  const i = argv.indexOf('--dir')
  return i >= 0 ? argv[i + 1] : path.join(REPO_ROOT, 'apps/site/public/api/v1')
}

async function verifyCatalog(dir) {
  const json = readFileSync(path.join(dir, 'catalog.json'))
  const sig = readFileSync(path.join(dir, 'catalog.json.sig'), 'utf8')
  const pub = readFileSync(PUBKEY, 'utf8')

  if (!verifyBytes(json, sig, pub)) throw new Error('signature does NOT verify against the committed public key')

  const sdk = await import(pathToFileURL(path.join(REPO_ROOT, 'packages/plugin-sdk/dist/index.js')).href)
  const res = sdk.parseCatalog(JSON.parse(json.toString('utf8')))
  if (!res.ok) throw new Error(`catalog shape invalid:\n${res.errors.join('\n')}`)

  return { plugins: res.value.plugins.length }
}

async function main() {
  const dir = parseDir(process.argv.slice(2))
  const result = await verifyCatalog(dir)
  console.log(`catalog OK — signature verified, ${result.plugins} plugin(s) (${dir})`)
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`catalog VERIFY FAILED: ${String(e.message || e)}`)
    process.exit(1)
  })
}

module.exports = { parseDir, verifyCatalog }
