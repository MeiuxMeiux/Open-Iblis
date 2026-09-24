// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { createServer } from 'node:net'

// Ask the OS for a free ephemeral port by binding :0 and reading it back.
// There is an inherent race (the port is briefly free between close and the
// sidecar binding it) but the sidecar binds 127.0.0.1 immediately on spawn.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}
