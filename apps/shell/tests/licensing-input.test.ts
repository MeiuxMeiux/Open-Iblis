// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Security audit 2026-09-24: the product-key insertion path validates the key
// locally before any network egress (L-KEY5), and the licensing document is
// owner-only and read with a size bound (L-KEY6).
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createLicensingService,
  normalizeProductKey,
  type LicensingDeps
} from '../electron/main/licensing/service'
import {
  createLicensingStore,
  emptyLicensingDocument,
  type LicensingDocument
} from '../electron/main/licensing/store'
import type { KeysResult } from '../electron/main/licensing/remote'

describe('normalizeProductKey', () => {
  it('accepts the display form, lowercase, and Crockford aliases', () => {
    expect(normalizeProductKey('IBLIS-AAAA-BBBB-CCCC-DD12')).toBe('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(normalizeProductKey('  iblis aaaa bbbb cccc dd12 ')).toBe('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(normalizeProductKey('AAAA-BBBB-CCCC-DDlO')).toBe('IBLIS-AAAA-BBBB-CCCC-DD10')
  })

  it('rejects wrong length, the U letter, and oversized input', () => {
    expect(normalizeProductKey('')).toBeNull()
    expect(normalizeProductKey('IBLIS-AAAA-BBBB-CCCC-DD1')).toBeNull()
    expect(normalizeProductKey('IBLIS-AAAA-BBBB-CCCC-DD1U')).toBeNull()
    expect(normalizeProductKey('A'.repeat(10_000))).toBeNull()
  })
})

function deps(calls: string[]): LicensingDeps {
  let doc: LicensingDocument = emptyLicensingDocument()
  const refused: KeysResult = { ok: false, code: 'unknown_key', detail: '' }
  return {
    now: () => Date.parse('2026-09-24T12:00:00Z'),
    store: {
      load: async () => doc,
      replace: async (d) => {
        doc = JSON.parse(JSON.stringify(d)) as LicensingDocument
      }
    },
    seal: (s) => `plain:${s}`,
    unseal: (s) => s.slice(6),
    installIdHash: () => 'a'.repeat(64),
    fingerprint: () => 'b'.repeat(64),
    fingerprintParts: () => ['p1'],
    appVersion: () => '0.0.0-test',
    activate: async (key) => {
      calls.push(key)
      return refused
    },
    renew: async () => refused,
    deactivate: async () => refused,
    parse: () => null,
    onState: () => undefined,
    enforced: true
  }
}

describe('activateKey input handling', () => {
  it('never sends a malformed key to the server', async () => {
    const calls: string[] = []
    const svc = createLicensingService(deps(calls))
    const s = await svc.activateKey('not a key at all')
    expect(calls).toEqual([])
    expect(s.status).toBe('keyless')
    expect(s.lastError).toBe('unknown_key')
  })

  it('sends only the normalized display form', async () => {
    const calls: string[] = []
    const svc = createLicensingService(deps(calls))
    await svc.activateKey(' iblis-aaaa-bbbb-cccc-dd12\n')
    expect(calls).toEqual(['IBLIS-AAAA-BBBB-CCCC-DD12'])
  })
})

describe('licensing store hardening', () => {
  it('quarantines an oversized document instead of parsing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iblis-lic-'))
    const file = join(dir, 'licensing.json')
    await writeFile(file, ' '.repeat(70 * 1024))
    const doc = await createLicensingStore(file).load()
    expect(doc).toEqual(emptyLicensingDocument())
    expect((await readFile(`${file}.corrupt`)).length).toBe(70 * 1024)
  })

  it.skipIf(process.platform === 'win32')('writes the document owner-only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iblis-lic-'))
    const file = join(dir, 'licensing.json')
    const store = createLicensingStore(file)
    await store.replace({ ...emptyLicensingDocument(), keySealed: 'plain:X' })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect((await store.load()).keySealed).toBe('plain:X')
  })
})
