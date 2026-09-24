// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Interfaces of the licensing state machine; implementation in ./service.ts.

import type { LeasePayload } from './lease'
import type { LicensingStore } from './store'
import type { KeysResult } from './remote'
import type { LicensingFeature, LicensingState } from '../../../shared/licensing'

export interface LicensingDeps {
  now(): number
  store: LicensingStore
  seal(secret: string): string
  unseal(sealed: string): string | null
  installIdHash(): string
  fingerprint(): string
  fingerprintParts(): string[]
  appVersion(): string
  activate(
    key: string,
    installId: string,
    fp: string,
    parts: string[],
    appVersion: string
  ): Promise<KeysResult>
  renew(
    lease: string,
    installId: string,
    fp: string,
    parts: string[],
    appVersion: string
  ): Promise<KeysResult>
  deactivate(lease: string, installId: string): Promise<KeysResult>
  parse(lease: string): LeasePayload | null
  onState(state: LicensingState): void
  enforced: boolean
}

export interface LicensingService {
  init(): Promise<void>
  stop(): void
  state(): LicensingState
  // The raw lease sent as the community-trainings credential, or null unless
  // licensed (bound + fresh). The server derives the quota subject from it.
  currentLease(): string | null
  activateKey(key: string): Promise<LicensingState>
  removeKey(): Promise<LicensingState>
  refresh(): Promise<LicensingState>
  maybeRenew(): Promise<void>
  // Null = allowed. Otherwise the stable refusal code the gate surfaces.
  // Local features (generation, training) are always allowed (D-O2); service
  // features refuse without a live lease when enforced (dark builds only log).
  requireFeature(feature: LicensingFeature): string | null
  // Gate for high-value actions: opportunistically re-checks online (so a
  // revoked key is caught promptly) before evaluating the local gate.
  // maxAgeMs=0 always re-checks; a positive value throttles. Offline never
  // blocks — the lease still governs until it actually expires.
  gateCheck(feature: LicensingFeature, maxAgeMs: number): Promise<string | null>
}
