// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { protocol } from 'electron'

// All renderer-readable local media schemes are declared together because
// Electron requires privileged schemes to be registered before app ready.
export function registerMediaSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'iblis-track', privileges: { stream: true } },
    { scheme: 'iblis-probe', privileges: { stream: true } }
  ])
}
