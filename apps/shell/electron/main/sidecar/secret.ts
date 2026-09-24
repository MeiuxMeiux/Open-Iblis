// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { randomBytes } from 'node:crypto'

// Per-process session secret. The shell passes it to the sidecar in an env var
// and on every request header; the sidecar rejects anything else, so another
// local process cannot drive the sidecar even though it listens on localhost.
export function sessionSecret(): string {
  return randomBytes(24).toString('hex')
}
