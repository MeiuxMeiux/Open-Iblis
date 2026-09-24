// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The licensing state machine (docs/admin/03-shell-integration.md):
//   keyless -> licensed -> (stale | ended) with silent renewals in between.
// Everything impure is injected so the whole machine unit-tests with a fake
// clock and scripted server answers. Wire-up lives in ./index.ts.

import { log } from '../logger'
import { leaseBindsToMachine, leaseExpiresAtMs, type LeasePayload } from './lease'
import { emptyLicensingDocument, type LicensingDocument } from './store'
import type { KeysResult } from './remote'
import {
  isServiceFeature,
  type LicensingFeature,
  type LicensingState
} from '../../../shared/licensing'
import { errorMessage } from '../error-message'

// Baked at build time (electron.vite.config.ts define), never a remote flag.
export const LICENSING_ENFORCE = process.env.LICENSING_ENFORCE === 'true'

// Ratified tunables (01 doc): renew when < 3 days remain; 24 h clock-
// rollback tolerance; check every 12 h while running.
const RENEW_BEFORE_MS = 3 * 86_400_000
const ROLLBACK_TOLERANCE_MS = 86_400_000
const RENEW_CHECK_INTERVAL_MS = 12 * 3_600_000
// Revocation reaches a running install even on a still-fresh lease: the
// periodic timer forces an online re-check at least this often (so a revoked
// key darkens within ~12 h of normal running, not only when the 7-day lease
// nears expiry), and service actions opportunistically re-check through
// gateCheck. Both are additive to the launch check and manual "Revalidate now".
const REVALIDATE_EVERY_MS = 12 * 3_600_000

const TERMINAL_CODES = new Set(['revoked', 'expired', 'activation_cap', 'unknown_key', 'flagged'])

export type { LicensingDeps, LicensingService } from './types'
import type { LicensingDeps, LicensingService } from './types'
import { maskKey, normalizeProductKey } from './product-key'
export { normalizeProductKey } from './product-key'

export function createLicensingService(deps: LicensingDeps): LicensingService {
  let doc: LicensingDocument = emptyLicensingDocument()
  let rollbackHold = false
  let timer: ReturnType<typeof setInterval> | null = null
  let lastLoggedStatus = ''
  // Wall-clock of the last online activate/renew *attempt* (success or
  // failure). Drives the revalidation throttles; 0 means "never contacted
  // this run", so launch always re-checks.
  let lastOnlineCheckAt = 0

  function payload(): LeasePayload | null {
    return doc.lease === null ? null : deps.parse(doc.lease)
  }

  function computeState(): LicensingState {
    const p = payload()
    const base = {
      maskedKey: doc.maskedKey,
      lastError: doc.lastError,
      enforced: deps.enforced
    }
    if (doc.endedReason !== null) {
      return {
        status: 'ended',
        reason: doc.endedReason,
        keyExpiresAt: p?.keyExpiresAt ?? null,
        leaseExpiresAt: p?.leaseExpiresAt ?? null,
        features: [],
        ...base
      }
    }
    if (doc.keySealed === null || p === null) {
      return {
        status: 'keyless',
        reason: null,
        keyExpiresAt: null,
        leaseExpiresAt: null,
        features: [],
        ...base
      }
    }
    // A lease copied from another install (or another machine) verifies but
    // does not bind (01 doc); it counts as stale — refresh re-activates with
    // the stored key. Binding requires both the install id and the hardware:
    // a copied licensing.json on a different box shares no network adapter, so
    // it never shows licensed, even fully offline (H1 fix).
    const bound =
      p.installId === deps.installIdHash() &&
      leaseBindsToMachine(p, deps.fingerprint(), deps.fingerprintParts())
    const fresh = bound && !rollbackHold && leaseExpiresAtMs(p) > deps.now()
    return {
      status: fresh ? 'licensed' : 'stale',
      reason: null,
      keyExpiresAt: p.keyExpiresAt,
      leaseExpiresAt: p.leaseExpiresAt,
      features: fresh ? (p.features as LicensingFeature[]) : [],
      ...base
    }
  }

  function push(state: LicensingState): void {
    if (state.status !== lastLoggedStatus) {
      lastLoggedStatus = state.status
      log('info', 'licensing state', {
        component: 'licensing',
        status: state.status,
        reason: state.reason,
        lastError: state.lastError
      })
    }
    deps.onState(state)
  }

  async function persist(mutate: (d: LicensingDocument) => void): Promise<LicensingState> {
    mutate(doc)
    doc.lastWallClock = Math.max(doc.lastWallClock, deps.now())
    await deps.store.replace(doc)
    const state = computeState()
    push(state)
    return state
  }

  function applyGrant(d: LicensingDocument, lease: string): void {
    d.lease = lease
    d.endedReason = null
    d.lastError = null
  }

  async function activateWith(key: string, sealKey: boolean): Promise<LicensingState> {
    let result: KeysResult
    lastOnlineCheckAt = deps.now()
    try {
      result = await deps.activate(
        key,
        deps.installIdHash(),
        deps.fingerprint(),
        deps.fingerprintParts(),
        deps.appVersion()
      )
    } catch (error) {
      log('warn', 'license activation unreachable', {
        component: 'licensing',
        error: errorMessage(error)
      })
      return persist((d) => {
        d.lastError = 'offline'
      })
    }
    if (!result.ok) {
      const code = result.code
      log('warn', 'license activation refused', { component: 'licensing', code })
      return persist((d) => {
        d.lastError = code
        // A terminal refusal of the STORED key ends the license; a refusal
        // of a key being typed in just reports (the user may retype).
        if (!sealKey && TERMINAL_CODES.has(code)) d.endedReason = code
      })
    }
    rollbackHold = false
    const grant = result.grant
    log('info', 'license activated', {
      component: 'licensing',
      activationsUsed: grant.activationsUsed,
      maxActivations: grant.maxActivations
    })
    return persist((d) => {
      if (sealKey) {
        d.keySealed = deps.seal(key)
        d.maskedKey = maskKey(key)
      }
      applyGrant(d, grant.lease)
    })
  }

  async function reactivate(): Promise<LicensingState> {
    const key = doc.keySealed === null ? null : deps.unseal(doc.keySealed)
    if (key === null) {
      log('warn', 'stored key unreadable; cannot re-activate', { component: 'licensing' })
      return persist((d) => {
        d.lastError = 'key_unreadable'
      })
    }
    return activateWith(key, false)
  }

  async function renewNow(): Promise<LicensingState> {
    const lease = doc.lease
    if (lease === null) return reactivate()
    let result: KeysResult
    lastOnlineCheckAt = deps.now()
    try {
      result = await deps.renew(
        lease,
        deps.installIdHash(),
        deps.fingerprint(),
        deps.fingerprintParts(),
        deps.appVersion()
      )
    } catch (error) {
      log('warn', 'license renewal unreachable', {
        component: 'licensing',
        error: errorMessage(error)
      })
      return persist((d) => {
        d.lastError = 'offline'
      })
    }
    if (result.ok) {
      rollbackHold = false
      const grant = result.grant
      log('info', 'license renewed', { component: 'licensing' })
      return persist((d) => applyGrant(d, grant.lease))
    }
    if (result.code === 'stale_lease') return reactivate()
    log('warn', 'license renewal refused', { component: 'licensing', code: result.code })
    const code = result.code
    return persist((d) => {
      d.lastError = code
      if (TERMINAL_CODES.has(code)) d.endedReason = code
    })
  }

  async function maybeRenew(): Promise<void> {
    if (doc.endedReason !== null || doc.keySealed === null) return
    const p = payload()
    if (p === null) {
      await reactivate()
      return
    }
    const remaining = leaseExpiresAtMs(p) - deps.now()
    const sinceCheck = deps.now() - lastOnlineCheckAt
    // Renew when the lease nears expiry, on clock rollback, OR when the last
    // online contact is stale — the third clause is what makes revocation
    // bite on a still-fresh lease during ordinary running.
    if (rollbackHold || remaining < RENEW_BEFORE_MS || sinceCheck >= REVALIDATE_EVERY_MS) {
      await renewNow()
    }
  }

  // Opportunistic online re-check for a gated action, throttled by maxAgeMs.
  // Awaited by high-value gates so a revoked key is refused promptly; offline
  // failures leave the lease governing (grace) so honest offline use is fine.
  async function gateCheck(feature: LicensingFeature, maxAgeMs: number): Promise<string | null> {
    if (doc.endedReason === null && doc.keySealed !== null) {
      if (deps.now() - lastOnlineCheckAt >= maxAgeMs) await renewNow()
    }
    return requireFeature(feature)
  }

  function requireFeature(feature: LicensingFeature): string | null {
    // D-O2: the local app is free. No key state ever gates a local feature.
    if (!isServiceFeature(feature)) return null
    const state = computeState()
    const allowed = state.status === 'licensed' && state.features.includes(feature)
    if (allowed) return null
    const code =
      state.status === 'ended'
        ? `licensing:${state.reason ?? 'ended'}`
        : state.status === 'stale'
          ? 'licensing:stale'
          : 'licensing:required'
    if (!deps.enforced) {
      log('info', 'licensing gate pass-through (dark ship)', {
        component: 'licensing',
        feature,
        wouldBlock: code
      })
      return null
    }
    log('info', 'licensing gate refused', { component: 'licensing', feature, code })
    return code
  }

  return {
    async init(): Promise<void> {
      doc = await deps.store.load()
      if (deps.now() < doc.lastWallClock - ROLLBACK_TOLERANCE_MS) {
        // Clock rolled back beyond tolerance: distrust the lease until one
        // online renewal succeeds (03 doc §State machine).
        rollbackHold = true
        log('warn', 'clock rollback detected; lease held stale', { component: 'licensing' })
      }
      push(computeState())
      timer = setInterval(() => {
        void maybeRenew()
      }, RENEW_CHECK_INTERVAL_MS)
      timer.unref()
      await maybeRenew()
    },

    stop(): void {
      if (timer !== null) clearInterval(timer)
      timer = null
    },

    state(): LicensingState {
      return computeState()
    },

    currentLease(): string | null {
      // Only a lease we actually honor (bound to this machine + fresh) is worth
      // presenting; a stale/foreign lease would just be rejected server-side.
      return computeState().status === 'licensed' ? doc.lease : null
    },

    activateKey(key: string): Promise<LicensingState> {
      const normalized = normalizeProductKey(key)
      if (normalized === null) {
        log('warn', 'license activation refused locally: malformed key', {
          component: 'licensing'
        })
        return persist((d) => {
          d.lastError = 'unknown_key'
        })
      }
      return activateWith(normalized, true)
    },

    async removeKey(): Promise<LicensingState> {
      const lease = doc.lease
      if (lease !== null) {
        // Best-effort slot release; local wipe happens regardless.
        try {
          await deps.deactivate(lease, deps.installIdHash())
        } catch {
          /* offline deactivation just drops local state */
        }
      }
      log('info', 'license removed from this device', { component: 'licensing' })
      const kept = doc.lastWallClock
      doc = { ...emptyLicensingDocument(), lastWallClock: kept }
      await deps.store.replace(doc)
      const state = computeState()
      push(state)
      return state
    },

    refresh(): Promise<LicensingState> {
      return renewNow()
    },

    maybeRenew,
    requireFeature,
    gateCheck
  }
}
