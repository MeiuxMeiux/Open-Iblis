// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { SESSION_HEADER } from '@iblis/plugin-sdk'
import { errorMessage } from '../error-message'

const POLL_MS = 100

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Poll 127.0.0.1:<port><path> with the session header until the sidecar reports
// healthy or the deadline passes. Accepts both the Iblis stub shape
// (`{ ok: true }`) and the real ace-server shape (`{ status: "ok" }`) so a
// native engine that doesn't speak the Iblis health body still launches.
// Carrying the secret here also proves the header path works (a no-op for
// ace-server, which has no auth) before we declare the sidecar live.
export async function waitForHealth(
  port: number,
  path: string,
  secret: string,
  timeoutMs: number
): Promise<void> {
  const url = `http://127.0.0.1:${port}${path}`
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers: { [SESSION_HEADER]: secret } })
      const body = (await res.json()) as { ok?: boolean; status?: string }
      if (res.ok && (body.ok === true || body.status === 'ok')) return
      lastError = new Error(`health ${res.status}`)
    } catch (e) {
      lastError = e
    }
    await delay(POLL_MS)
  }
  throw new Error(`sidecar health timeout after ${timeoutMs}ms: ${errorMessage(lastError)}`)
}
