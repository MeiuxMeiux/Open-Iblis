// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The only licensing egress (renderer never touches the network). Talks to
// the public api/v1/keys endpoints; stable server refusal codes come back
// as values, transport problems (offline, timeout) as throws — the service
// treats the former as answers and the latter as weather. A build without a
// keys endpoint (a source build, official-endpoints.ts) answers with the
// 'not-configured' code and never touches the network.

import { NOT_CONFIGURED, serviceEndpoint } from '../official-endpoints'

const TIMEOUT_MS = 15_000

interface LeaseGrant {
  lease: string
  keyExpiresAt: string
  activationsUsed: number
  maxActivations: number
}

export type KeysResult =
  { ok: true; grant: LeaseGrant } | { ok: false; code: string; detail: string }

async function keysRequest(path: string, payload: Record<string, unknown>): Promise<KeysResult> {
  const base = serviceEndpoint('keys')
  if (base === null) {
    return { ok: false, code: NOT_CONFIGURED, detail: 'this build has no licensing endpoint' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/${path}.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      // Our licensing host does not redirect; refuse so a bounce can't relay
      // the key/lease payload to another origin.
      redirect: 'error'
    })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (body.ok === true && typeof body.data === 'object' && body.data !== null) {
      const d = body.data as Record<string, unknown>
      return {
        ok: true,
        grant: {
          // Non-string fields become '' and fail lease parsing downstream.
          lease: typeof d.lease === 'string' ? d.lease : '',
          keyExpiresAt: typeof d.keyExpiresAt === 'string' ? d.keyExpiresAt : '',
          activationsUsed: Number(d.activationsUsed ?? 0),
          maxActivations: Number(d.maxActivations ?? 0)
        }
      }
    }
    return {
      ok: false,
      code: typeof body.error === 'string' ? body.error : `http_${response.status}`,
      detail: typeof body.detail === 'string' ? body.detail : ''
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('the licensing service timed out', { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function activateRemote(
  key: string,
  installId: string,
  fingerprint: string,
  fingerprintParts: string[],
  appVersion: string
): Promise<KeysResult> {
  return keysRequest('activate', { key, installId, fingerprint, fingerprintParts, appVersion })
}

export function renewRemote(
  lease: string,
  installId: string,
  fingerprint: string,
  fingerprintParts: string[],
  appVersion: string
): Promise<KeysResult> {
  return keysRequest('renew', { lease, installId, fingerprint, fingerprintParts, appVersion })
}

export function deactivateRemote(lease: string, installId: string): Promise<KeysResult> {
  return keysRequest('deactivate', { lease, installId })
}
