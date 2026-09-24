// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Real-world wiring for the licensing service: electron safeStorage seals
// the key at rest, state pushes broadcast to every window, and the gates
// the IPC choke points call live here. See docs/admin/03-shell-integration.md.

import { app, BrowserWindow, safeStorage } from 'electron'
import { join } from 'node:path'
import { log, recentEvents } from '../logger'
import { installId } from '../install-id'
import { originHashOf } from '../styles/trainings-index'
import { machineFingerprint, machineFingerprintParts } from './machine'
import { parseLease } from './lease'
import { createLicensingStore } from './store'
import { activateRemote, deactivateRemote, renewRemote } from './remote'
import { createLicensingService, LICENSING_ENFORCE, type LicensingService } from './service'
import type { LicensingState, ServiceFeature } from '../../../shared/licensing'

function seal(secret: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(secret).toString('base64')
    }
  } catch {
    /* fall through to plain */
  }
  return 'plain:' + secret
}

function unseal(sealed: string): string | null {
  if (sealed.startsWith('plain:')) return sealed.slice('plain:'.length)
  if (sealed.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(sealed.slice('enc:'.length), 'base64'))
    } catch {
      return null
    }
  }
  return null
}

function broadcast(state: LicensingState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('licensing:state', state)
  }
}

let service: LicensingService | null = null

export function initLicensing(): void {
  if (service !== null) return
  service = createLicensingService({
    now: () => Date.now(),
    store: createLicensingStore(join(app.getPath('userData'), 'licensing.json')),
    seal,
    unseal,
    installIdHash: () => originHashOf(installId()),
    fingerprint: machineFingerprint,
    fingerprintParts: machineFingerprintParts,
    appVersion: () => app.getVersion(),
    activate: activateRemote,
    renew: renewRemote,
    deactivate: deactivateRemote,
    parse: parseLease,
    onState: broadcast,
    enforced: LICENSING_ENFORCE
  })
  void service.init()
  log('info', 'licensing service initialized', {
    component: 'licensing',
    enforced: LICENSING_ENFORCE
  })
}

export function licensingService(): LicensingService {
  if (service === null) throw new Error('licensing service not initialized')
  return service
}

// The authoritative gate the service IPC choke points call (community styles
// index/download). It re-checks online first (throttled by maxAgeMs) so a
// revoked key is caught promptly, then throws inside guardAsync so the
// renderer receives {ok:false, error:'licensing:<code>'}; pass-through while
// shipping dark. Typed to service features: local generation and training are
// never gated (D-O2, shared/licensing.ts FEATURE_SCOPE). maxAgeMs=0 always
// re-checks (a community download); a positive value throttles (browsing the
// community index). Offline never blocks: the lease governs until it expires.
export async function requireLicenseFresh(feature: ServiceFeature, maxAgeMs = 0): Promise<void> {
  if (service === null) return
  const code = await service.gateCheck(feature, maxAgeMs)
  if (code !== null) throw new Error(code)
}

// The entitlement lease to attach as the community-trainings credential (K5).
// Null unless licensed; the trainings client then sends the legacy token only.
// See apps/site/src/Trainings/Api.php and training/remote.ts.
export function currentLease(): string | null {
  return service?.currentLease() ?? null
}

// Unlike ordinary product gates, the private processor lab is never dark-mode
// pass-through: a valid lease must contain the explicitly issued `labs`
// feature before its credential can leave the app.
export function currentLeaseForFeature(feature: ServiceFeature): string | null {
  const state = service?.state()
  if (state?.status !== 'licensed' || !state.features.includes(feature)) return null
  return service?.currentLease() ?? null
}

// The licensing section of a diagnostics bundle: state (masked key only —
// never key material) plus the last licensing log events. Two-sided story
// with the server's per-key timeline.
export function licensingDiagSummary(): Record<string, unknown> {
  return {
    state: service?.state() ?? null,
    enforced: LICENSING_ENFORCE,
    recentEvents: recentEvents()
      .filter((line) => line.includes('"component":"licensing"'))
      .slice(-20)
  }
}
