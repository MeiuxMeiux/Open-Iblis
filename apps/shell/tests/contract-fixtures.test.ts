// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Consumer side of the wire contracts in contracts/ (see its README). The
// golden lease and trainings index were produced by the server code and are
// reproduced byte for byte by its own tests, so a change on either side that
// breaks the other fails one of the two suites.
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { safetensorsProblem } from '../electron/main/adapters/safetensors'
import { buildBundle } from '../electron/main/diag/bundle'
import { leaseBindsToMachine, parseLease } from '../electron/main/licensing/lease'
import { originHashOf, verifyTrainingsIndex } from '../electron/main/styles/trainings-index'

const CONTRACTS = join(__dirname, '..', '..', '..', 'contracts')
const read = (rel: string): Buffer => readFileSync(join(CONTRACTS, rel))
const json = (rel: string): unknown => JSON.parse(read(rel).toString('utf8'))

// Same derivation as apps/site/tests/ContractFixturesTest.php. Test-only:
// the seed is public, so nothing it signs is trusted outside these suites.
const seed = createHash('sha256').update('iblis contract fixtures: test-only signing seed').digest()
const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
const pubPem = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' }))
  .export({ type: 'spki', format: 'pem' })
  .toString()

describe('contract: entitlement lease', () => {
  const lease = read('lease/lease.txt').toString('utf8').trim()
  const inputs = json('lease/inputs.json') as { fingerprint: string; parts: string[] }

  it('verifies the server-issued lease and reads the same payload', () => {
    expect(parseLease(lease, pubPem)).toEqual(json('lease/payload.json'))
  })

  it('binds to the machine that activated and not to another', () => {
    const payload = parseLease(lease, pubPem)
    if (payload === null) throw new Error('fixture lease did not verify')
    expect(leaseBindsToMachine(payload, inputs.fingerprint, inputs.parts)).toBe(true)
    expect(leaseBindsToMachine(payload, inputs.fingerprint, [inputs.parts[1] ?? ''])).toBe(true)
    expect(leaseBindsToMachine(payload, inputs.fingerprint, ['3'.repeat(64)])).toBe(false)
  })

  it('rejects the lease under the production key and when altered', () => {
    expect(parseLease(lease)).toBeNull()
    const [p64 = '', s64 = ''] = lease.split('.')
    const forged = Buffer.from(p64, 'base64url')
      .toString('utf8')
      .replace('key-fixture', 'key-forged')
    expect(parseLease(`${Buffer.from(forged).toString('base64url')}.${s64}`, pubPem)).toBeNull()
  })
})

describe('contract: trainings index', () => {
  const bytes = read('trainings/index.json')
  const sig = read('trainings/index.json.sig').toString('utf8')

  it('verifies and parses the server-rendered index', () => {
    const index = verifyTrainingsIndex(bytes, sig, pubPem)
    expect(index.generatedAt).toBe('2027-01-15T08:00:00+00:00')
    expect(index.entries.map((e) => e.id)).toEqual(['tr-fedcba9876543210', 'tr-0123456789abcdef'])
    const tape = index.entries[1]
    expect(tape?.previewUrl).toMatch(/\/tr-0123456789abcdef\/v2\/preview\.mp3$/)
    expect(tape?.originHash).toBe(originHashOf('install-a'))
    expect(index.entries[0]?.previewUrl).toBeNull()
  })

  it('refuses one changed byte', () => {
    const altered = Buffer.from(bytes)
    const at = altered.length - 2
    altered[at] = (altered[at] ?? 0) ^ 1
    expect(() => verifyTrainingsIndex(altered, sig, pubPem)).toThrow(/signature/)
  })
})

// Field names and value types, recursively; arrays by their first element.
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > 0 ? [shape(value[0])] : []
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    return Object.fromEntries(entries.map(([k, v]) => [k, shape(v)]))
  }
  return value === null ? 'null' : typeof value
}

describe('contract: diagnostics bundle', () => {
  // Plain Node has no Electron runtime versions; the packaged app does.
  const runtimes = ['electron', 'chrome']
  beforeEach(() => {
    for (const r of runtimes)
      Object.defineProperty(process.versions, r, { value: '0.0.0', configurable: true })
  })
  afterEach(() => {
    for (const r of runtimes) Reflect.deleteProperty(process.versions, r)
  })

  it('builds the fields and types the server fixture pins', async () => {
    const wire = JSON.parse(JSON.stringify(await buildBundle('errors'))) as Record<string, unknown>
    // Sections whose contents depend on the machine (installed plugins,
    // running sidecars, log files) are compared by presence only.
    const fixed = (bundle: Record<string, unknown>): Record<string, unknown> => {
      const { plugins, health, logs, ...rest } = bundle
      expect([plugins, health, logs]).not.toContain(undefined)
      return rest
    }
    expect(shape(fixed(wire))).toEqual(
      shape(fixed(json('diag/bundle.json') as Record<string, unknown>))
    )
    expect(wire.installId).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
  })
})

interface SafetensorsCase {
  name: string
  ok: boolean
  header?: string
  headerBase64?: string
  dataBytes?: number
  padTo?: number
  raw?: string
  reason?: string
}

// raw: the whole file in hex; otherwise u64le length + header + zeroed data.
function safetensorsFile(c: SafetensorsCase): Buffer {
  if (c.raw !== undefined) return Buffer.from(c.raw, 'hex')
  const text =
    c.headerBase64 !== undefined
      ? Buffer.from(c.headerBase64, 'base64')
      : Buffer.from(c.header ?? '')
  const header = Buffer.concat([text, Buffer.alloc(Math.max(0, (c.padTo ?? 0) - text.length), ' ')])
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(header.length))
  return Buffer.concat([len, header, Buffer.alloc(c.dataBytes ?? 0)])
}

describe('contract: safetensors verdicts (shared with the server mirror)', () => {
  const cases = json('safetensors/cases.json') as SafetensorsCase[]
  const dir = mkdtempSync(join(tmpdir(), 'iblis-st-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const file = join(dir, 'case.safetensors')
    writeFileSync(file, safetensorsFile(c))
    const problem = await safetensorsProblem(file)
    expect(problem === null ? 'accepted' : `refused: ${problem}`).toMatch(
      c.ok ? /^accepted$/ : /^refused/
    )
  })
})
