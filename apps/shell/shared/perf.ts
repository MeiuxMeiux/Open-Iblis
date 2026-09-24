// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Performance profile types (Settings -> Performance). Split from
// contract.ts for the LOC cap; re-exported there so importers are unchanged.

export type PerfProfile = 'safe' | 'balanced' | 'max' | 'custom'

export interface PerfSettings {
  profile: PerfProfile
  // Thread count when profile === 'custom'; ignored otherwise. 0 = unset.
  customThreads: number
}

export interface PerfInfo {
  settings: PerfSettings
  logicalCores: number
  // Concrete thread count each fixed profile resolves to on this machine, so the
  // UI can label them ("Safe — 8 threads") without re-deriving the formula.
  threads: { safe: number; balanced: number; max: number }
}
