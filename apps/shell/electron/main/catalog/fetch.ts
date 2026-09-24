// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Thin HTTPS fetch helpers for the catalog. The main process is the only place
// allowed to touch the network (the renderer's CSP is connect-src 'none').
// Aborts on a slow server so a hung host never wedges the UI.

const TIMEOUT_MS = 15_000
type RequestHeaders = Record<string, string>

async function get(url: string, headers?: RequestHeaders): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    // Our own signed-catalog host never redirects; refusing redirects stops a
    // hijacked DNS/proxy from bouncing the pre-verification fetch elsewhere.
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'error', headers })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchBytes(url: string, headers?: RequestHeaders): Promise<Buffer> {
  return Buffer.from(await (await get(url, headers)).arrayBuffer())
}

export async function fetchText(url: string, headers?: RequestHeaders): Promise<string> {
  return (await get(url, headers)).text()
}
