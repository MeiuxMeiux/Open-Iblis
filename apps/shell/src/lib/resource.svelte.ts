// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ResourceState } from '../../shared/training'

// The shared resource-lock truth (idle/generating/training/engine-mutation).
// Create, Training, and the player area all render this one snapshot.
let state = $state<ResourceState | null>(null)
let subscribed = false
let receivedPush = false

export const resource = {
  get state(): ResourceState | null {
    return state
  },
  get training(): boolean {
    return state?.state === 'training'
  },
  get detail(): string | null {
    return state?.detail ?? null
  },

  async initialize(): Promise<void> {
    if (!subscribed) {
      subscribed = true
      window.iblis.resource.onState((next: ResourceState) => {
        receivedPush = true
        state = next
      })
    }
    try {
      const result = await window.iblis.resource.state()
      // A pushed state can overtake the initial request; the push wins.
      if (result.ok && !receivedPush) state = result.data
    } catch {
      // The lock banner is additive UI — a failed read renders nothing.
    }
  }
}
