// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Licensing domain types shared by main, preload, and renderer.
// Protocol: docs/admin/01-product-keys.md; shell design: 03-shell-integration.md.

export type LicensingFeature = 'training' | 'generation' | 'styles-community' | 'labs'

// Decision D-O2 (docs/planning/2026-09-24-open-source): the local app is free.
// A 'local' feature runs entirely on this machine and is never gated, in any
// build, whatever the key state. A 'service' feature talks to a hosted Iblis
// service and needs a valid key. Leases may still list local features (the
// protocol predates D-O2); the shell simply never checks them. Main and
// renderer both consult this table, so the split lives in exactly one place.
const FEATURE_SCOPE = {
  generation: 'local',
  training: 'local',
  'styles-community': 'service',
  labs: 'service'
} as const satisfies Record<LicensingFeature, 'local' | 'service'>

// The features a product key can gate. Gate helpers take this narrower type,
// so gating a local feature is a compile error rather than a runtime surprise.
export type ServiceFeature = {
  [F in LicensingFeature]: (typeof FEATURE_SCOPE)[F] extends 'service' ? F : never
}[LicensingFeature]

export function isServiceFeature(feature: LicensingFeature): feature is ServiceFeature {
  return FEATURE_SCOPE[feature] === 'service'
}

// keyless: no product key entered. licensed: verified unexpired lease bound
// to this install. stale: lease aged out without server contact (offline) —
// re-locks service surfaces until one renewal succeeds. ended: the server gave
// a terminal answer (revoked/expired/cap); reason names it.
type LicensingStatus = 'keyless' | 'licensed' | 'stale' | 'ended'

export interface LicensingState {
  status: LicensingStatus
  // Terminal server code when status is 'ended' (revoked | expired |
  // activation_cap | unknown_key | flagged), else null.
  reason: string | null
  // IBLIS-****-****-****-AB12 — the renderer never sees the full key.
  maskedKey: string | null
  keyExpiresAt: string | null
  leaseExpiresAt: string | null
  features: LicensingFeature[]
  // Stable error code of the last failed activate/renew ('offline', a server
  // refusal code, or null). Cleared by any success.
  lastError: string | null
  // Build-time LICENSING_ENFORCE const. Applies to service features only.
  enforced: boolean
}
