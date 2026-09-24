// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { LicensingState, ServiceFeature } from '../../shared/licensing'

// The renderer's single source of licensing truth. Main pushes a fresh
// LicensingState on every transition (activation, renewal, revocation), so the
// gates re-render live: revoke a key in the admin panel and the app's locks
// flip the moment the next revalidation learns it. See docs/admin/03.
let state = $state<LicensingState | null>(null)
let subscribed = false
let receivedPush = false
// One dismissible banner per session at most, and only when a key that used
// to work has ended (03 doc §GUI). A keyless install never sees it: the local
// app is free (D-O2). Module-scoped so it survives view switches.
let bannerDismissed = $state(false)

// Only service features can lock (the type makes gating generation or training
// a compile error). Mirrors the main-process gate: nothing locks while
// enforcement is dark or before the first state arrives.
function locks(s: LicensingState | null, feature: ServiceFeature): boolean {
  if (!s?.enforced) return false
  return !(s.status === 'licensed' && s.features.includes(feature))
}

export const licensing = {
  get state(): LicensingState | null {
    return state
  },
  get enforced(): boolean {
    return state?.enforced === true
  },
  get status(): LicensingState['status'] | null {
    return state?.status ?? null
  },
  // True when a service surface should show its locked presentation.
  locked(feature: ServiceFeature): boolean {
    return locks(state, feature)
  },
  // A previously working key has ended (revoked, expired, cap). Keyless and
  // stale installs do not qualify; neither does a dark build.
  get keyEnded(): boolean {
    return state?.status === 'ended' && locks(state, 'styles-community')
  },
  get bannerVisible(): boolean {
    return !bannerDismissed && this.keyEnded
  },
  dismissBanner(): void {
    bannerDismissed = true
  },

  async initialize(): Promise<void> {
    if (!subscribed) {
      subscribed = true
      window.iblis.licensing.onState((next: LicensingState) => {
        receivedPush = true
        state = next
      })
    }
    try {
      const result = await window.iblis.licensing.state()
      if (result.ok && !receivedPush) state = result.data
    } catch {
      // Licensing UI is additive; a failed read simply gates nothing.
    }
  }
}
