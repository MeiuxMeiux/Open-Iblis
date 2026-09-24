// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// State-machine transitions with a fake clock and scripted server answers:
// keyless -> licensed -> renewed / stale / ended, clock rollback, gates.
import { describe, expect, it } from 'vitest'
import { createLicensingService, type LicensingDeps } from '../electron/main/licensing/service'
import { parseLease } from '../electron/main/licensing/lease'
import {
  emptyLicensingDocument,
  type LicensingDocument,
  type LicensingStore
} from '../electron/main/licensing/store'
import type { KeysResult } from '../electron/main/licensing/remote'
import type { LicensingState } from '../shared/licensing'
import { payloadFixture, signLease, testPubPem } from './licensing-fixtures'

const pubPem = testPubPem

const T0 = Date.parse('2026-07-14T12:00:00Z')
const DAY = 86_400_000
const INSTALL = 'a'.repeat(64)

function memoryStore(initial: LicensingDocument = emptyLicensingDocument()): LicensingStore & {
  doc: LicensingDocument
} {
  const box = {
    doc: initial,
    async load(): Promise<LicensingDocument> {
      return box.doc
    },
    async replace(d: LicensingDocument): Promise<void> {
      box.doc = JSON.parse(JSON.stringify(d)) as LicensingDocument
    }
  }
  return box
}

// The lease the server issues carries the adapter hashes the machine
// presented at activation, so tests grant a lease bound to `machine.parts`.
function grant(leaseExpiresAt: string, parts: string[] = ['p1']): KeysResult {
  return {
    ok: true,
    grant: {
      lease: signLease(payloadFixture({ installId: INSTALL, leaseExpiresAt, fp: parts })),
      keyExpiresAt: '2026-08-13T12:00:00Z',
      activationsUsed: 1,
      maxActivations: 3
    }
  }
}

interface Harness {
  deps: LicensingDeps
  states: LicensingState[]
  clock: { now: number }
  // The machine the shell runs on: its combined fingerprint and per-adapter
  // hashes. Mutating these mid-test models moving licensing.json to another
  // box (no shared adapter) or hardware drift (one adapter in common).
  machine: { fp: string; parts: string[] }
  answers: { activate: () => KeysResult; renew: () => KeysResult }
}

function harness(overrides: Partial<LicensingDeps> = {}): Harness {
  const clock = { now: T0 }
  const machine = { fp: 'b'.repeat(64), parts: ['p1'] }
  const states: LicensingState[] = []
  const answers = {
    activate: (): KeysResult => grant('2026-07-21T12:00:00Z', machine.parts),
    renew: (): KeysResult => grant('2026-07-28T12:00:00Z', machine.parts)
  }
  const deps: LicensingDeps = {
    now: () => clock.now,
    store: memoryStore(),
    seal: (s) => `plain:${s}`,
    unseal: (s) => (s.startsWith('plain:') ? s.slice(6) : null),
    installIdHash: () => INSTALL,
    fingerprint: () => machine.fp,
    fingerprintParts: () => machine.parts,
    appVersion: () => '0.0.0-test',
    activate: async () => answers.activate(),
    renew: async () => answers.renew(),
    deactivate: async () => ({
      ok: true,
      grant: { lease: '', keyExpiresAt: '', activationsUsed: 0, maxActivations: 0 }
    }),
    parse: (lease) => parseLease(lease, pubPem),
    onState: (s) => states.push(s),
    enforced: true,
    ...overrides
  }
  return { deps, states, clock, machine, answers }
}

describe('licensing service', () => {
  it('activates a key and becomes licensed with features', async () => {
    const h = harness()
    const svc = createLicensingService(h.deps)
    const s = await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(s.status).toBe('licensed')
    expect(s.maskedKey).toBe('IBLIS-****-****-****-DD12')
    expect(s.features).toContain('styles-community')
    expect(svc.requireFeature('styles-community')).toBeNull()
  })

  it('exposes the raw lease only while licensed (K5 trainings credential)', async () => {
    const h = harness()
    const svc = createLicensingService(h.deps)
    expect(svc.currentLease()).toBeNull() // keyless
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(svc.state().status).toBe('licensed')
    const lease = svc.currentLease()
    expect(lease).not.toBeNull()
    expect(parseLease(lease!, pubPem)?.installId).toBe(INSTALL)
    h.clock.now = T0 + 8 * DAY // lease expires -> stale
    expect(svc.state().status).toBe('stale')
    expect(svc.currentLease()).toBeNull() // never hand out a lease we won't honor
  })

  it('reports server refusals as lastError and stays keyless', async () => {
    const h = harness()
    h.answers.activate = () => ({ ok: false, code: 'unknown_key', detail: '' })
    const svc = createLicensingService(h.deps)
    const s = await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(s.status).toBe('keyless')
    expect(s.lastError).toBe('unknown_key')
  })

  it('goes stale when the lease expires offline, then recovers on renew', async () => {
    const h = harness()
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    h.clock.now = T0 + 8 * DAY // past leaseExpiresAt
    expect(svc.state().status).toBe('stale')
    expect(svc.requireFeature('styles-community')).toBe('licensing:stale')
    h.answers.renew = () => grant('2026-07-29T12:00:00Z')
    const s = await svc.refresh()
    expect(s.status).toBe('licensed')
  })

  it('ends with the server reason when renewal says revoked', async () => {
    const h = harness()
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    h.answers.renew = () => ({ ok: false, code: 'revoked', detail: '' })
    const s = await svc.refresh()
    expect(s.status).toBe('ended')
    expect(s.reason).toBe('revoked')
    expect(svc.requireFeature('styles-community')).toBe('licensing:revoked')
  })

  it('falls back to re-activation with the stored key on stale_lease', async () => {
    const h = harness()
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    let reactivated = false
    h.answers.renew = () => ({ ok: false, code: 'stale_lease', detail: '' })
    h.answers.activate = () => {
      reactivated = true
      return grant('2026-07-30T12:00:00Z')
    }
    const s = await svc.refresh()
    expect(reactivated).toBe(true)
    expect(s.status).toBe('licensed')
  })

  it('treats offline renewal as weather: licensed until expiry, lastError set', async () => {
    const h = harness()
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    h.answers.renew = () => {
      throw new Error('fetch failed')
    }
    const s = await svc.refresh()
    expect(s.status).toBe('licensed')
    expect(s.lastError).toBe('offline')
  })

  it('holds the lease stale after a clock rollback until a renewal succeeds', async () => {
    const h = harness()
    const store = memoryStore()
    h.deps.store = store
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    // Reload on a machine whose clock rolled back 3 days.
    h.clock.now = T0 - 3 * DAY
    h.answers.renew = () => {
      throw new Error('offline')
    }
    const svc2 = createLicensingService(h.deps)
    await svc2.init()
    expect(svc2.state().status).toBe('stale')
    h.answers.renew = () => grant('2026-07-28T12:00:00Z')
    const s = await svc2.refresh()
    expect(s.status).toBe('licensed')
    svc2.stop()
  })

  it('removeKey wipes local state back to keyless', async () => {
    const h = harness()
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    const s = await svc.removeKey()
    expect(s.status).toBe('keyless')
    expect(s.maskedKey).toBeNull()
  })

  it('never gates local generation or training, even enforced and keyless (D-O2)', async () => {
    const h = harness({ enforced: true })
    const svc = createLicensingService(h.deps)
    expect(svc.state().status).toBe('keyless')
    expect(svc.requireFeature('generation')).toBeNull()
    expect(svc.requireFeature('training')).toBeNull()
    expect(await svc.gateCheck('training', 0)).toBeNull()
    // Service features still lock without a key.
    expect(svc.requireFeature('styles-community')).toBe('licensing:required')
    expect(svc.requireFeature('labs')).toBe('licensing:required')
  })

  it('keeps local features open after a key ends, while service features lock', async () => {
    const h = harness({ enforced: true })
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    h.answers.renew = () => ({ ok: false, code: 'revoked', detail: '' })
    await svc.refresh()
    expect(svc.state().status).toBe('ended')
    expect(svc.requireFeature('generation')).toBeNull()
    expect(svc.requireFeature('training')).toBeNull()
    expect(svc.requireFeature('styles-community')).toBe('licensing:revoked')
  })

  it('passes every gate through when not enforced (dark ship)', async () => {
    const h = harness({ enforced: false })
    const svc = createLicensingService(h.deps)
    expect(svc.requireFeature('generation')).toBeNull()
    expect(svc.requireFeature('training')).toBeNull()
    expect(svc.requireFeature('styles-community')).toBeNull()
  })

  it('gateCheck re-checks online and catches a revocation on a still-fresh lease', async () => {
    const h = harness()
    let renews = 0
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(svc.state().status).toBe('licensed')
    // Key gets revoked server-side while the lease is nowhere near expiry.
    h.answers.renew = () => {
      renews += 1
      return { ok: false, code: 'revoked', detail: '' }
    }
    // maxAgeMs=0 forces an online re-check; the revocation now bites.
    const code = await svc.gateCheck('styles-community', 0)
    expect(renews).toBe(1)
    expect(code).toBe('licensing:revoked')
    expect(svc.state().status).toBe('ended')
  })

  it('gateCheck throttles: within maxAgeMs it does not hit the server', async () => {
    const h = harness()
    let renews = 0
    h.answers.renew = () => {
      renews += 1
      return grant('2026-07-28T12:00:00Z')
    }
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12') // stamps lastOnlineCheckAt
    // A throttled gate right after activation must not re-hit the server.
    const code = await svc.gateCheck('styles-community', 60 * 60_000)
    expect(renews).toBe(0)
    expect(code).toBeNull()
  })

  it('re-locks when licensing.json is copied to another machine, even offline', async () => {
    const h = harness()
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(svc.state().status).toBe('licensed')
    // Same install folder, different box: no network adapter in common and a
    // different combined fingerprint. No server contact — this is purely the
    // offline binding check.
    h.machine.parts = ['other-adapter']
    h.machine.fp = 'c'.repeat(64)
    expect(svc.state().status).toBe('stale')
    expect(svc.requireFeature('styles-community')).toBe('licensing:stale')
  })

  it('stays licensed across hardware drift that keeps one adapter', async () => {
    const h = harness()
    h.machine.parts = ['nic-a', 'nic-b']
    const svc = createLicensingService(h.deps)
    await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(svc.state().status).toBe('licensed')
    // Docked / swapped one NIC: nic-a is gone, a new adapter appears, but
    // nic-b still overlaps the bound set — same machine, still licensed.
    h.machine.parts = ['nic-b', 'nic-c']
    h.machine.fp = 'd'.repeat(64)
    expect(svc.state().status).toBe('licensed')
    expect(svc.requireFeature('styles-community')).toBeNull()
  })

  it('rejects a lease bound to a different install as stale', async () => {
    const h = harness()
    h.answers.activate = () => ({
      ok: true,
      grant: {
        lease: signLease(payloadFixture({ installId: 'z'.repeat(64) })),
        keyExpiresAt: '2026-08-13T12:00:00Z',
        activationsUsed: 1,
        maxActivations: 3
      }
    })
    const svc = createLicensingService(h.deps)
    const s = await svc.activateKey('IBLIS-AAAA-BBBB-CCCC-DD12')
    expect(s.status).toBe('stale')
    expect(svc.requireFeature('styles-community')).toBe('licensing:stale')
  })
})
