// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Machine fingerprint for activation binding: a salted SHA-256 over the
// sorted physical MAC addresses. Decision A6 (docs/admin/00-overview.md):
// the raw addresses NEVER leave the machine — only this hash does, and it
// is disclosed on the privacy page. This is deliberately the app's only
// hardware-derived identity; everything else uses the random install UUID.

import { createHash } from 'node:crypto'
import { networkInterfaces } from 'node:os'

function physicalMacs(): string[] {
  const macs = new Set<string>()
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (!info.internal && info.mac && info.mac !== '00:00:00:00:00:00') {
        macs.add(info.mac.toLowerCase())
      }
    }
  }
  return [...macs].sort()
}

export function machineFingerprint(): string {
  const sorted = physicalMacs().join(',')
  return createHash('sha256').update(`iblis-fp1:${sorted}`).digest('hex')
}

// Per-adapter salted hashes for drift-tolerant activation binding (H1 fix).
// The combined machineFingerprint() changes wholesale when any adapter comes
// or goes (a dock, a VPN, a swapped NIC); these per-adapter hashes let the
// server and the offline client recognize the same machine by adapter overlap
// instead. As with the combined hash (decision A6), only salted digests leave
// the machine — never a raw address. Distinct salt so a part hash can never be
// correlated with the combined hash.
export function machineFingerprintParts(): string[] {
  return physicalMacs().map((mac) =>
    createHash('sha256').update(`iblis-fp1-part:${mac}`).digest('hex')
  )
}
