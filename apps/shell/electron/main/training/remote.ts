// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Client for the community-trainings service (name reservation; the chunked
// uploader builds on it). Protocol:
// docs/training/03-remote-service.md. Main process only — the renderer never
// sees URLs or leases.

import { app } from 'electron'
import { installId } from '../install-id'
import { currentLease } from '../licensing'
import type { TrainingCategory, TrainingReserveResult } from '../../../shared/training'
import { withCredentialHeader } from '../request-headers'
import { requireServiceEndpoint, serviceEndpoint } from '../official-endpoints'

const TIMEOUT_MS = 15_000

const TRAININGS_NOT_CONFIGURED =
  'Community uploads need an activated product key, so a name cannot be reserved.'

// The entitlement lease is the only credential the service accepts; no shared
// secret ships in a build. A source build has no trainings endpoint at all
// unless its builder set one (official-endpoints.ts).
export function trainingsConfigured(): boolean {
  return serviceEndpoint('trainings') !== null && currentLease() !== null
}

export async function trainingsRequest(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const base = requireServiceEndpoint('trainings')
  const lease = currentLease()
  if (lease === null) throw new Error(TRAININGS_NOT_CONFIGURED)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  // The entitlement lease authenticates the request; the server keys upload
  // quotas on its signed, unforgeable product-key id.
  try {
    const response = await fetch(`${base}/${path}`, {
      ...init,
      headers: withCredentialHeader(init.headers, 'X-Iblis-Lease', lease),
      signal: controller.signal,
      // Our trainings host does not redirect; refuse so a bounce can't forward
      // the lease to another origin.
      redirect: 'error'
    })
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    return { status: response.status, body }
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('the trainings service timed out', { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export interface ReservedTraining {
  trainingId: string
  version: number
  claimToken: string
}

export async function reserveTrainingName(
  name: string,
  categories: TrainingCategory[]
): Promise<TrainingReserveResult & { reserved?: ReservedTraining }> {
  const { status, body } = await trainingsRequest('reserve.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      categories,
      installId: installId(),
      appVersion: app.getVersion(),
      schemaVersion: 1
    })
  })
  if (body.ok === true) {
    const reserved: ReservedTraining = {
      trainingId: String(body.trainingId ?? ''),
      version: Number(body.version ?? 1),
      claimToken: String(body.claimToken ?? '')
    }
    if (!/^tr-[a-f0-9]{16}$/.test(reserved.trainingId) || reserved.claimToken.length !== 48) {
      throw new Error('the trainings service returned an invalid reservation')
    }
    return { available: true, trainingId: reserved.trainingId, version: reserved.version, reserved }
  }
  const message = String(body.error ?? `reservation failed (HTTP ${status})`)
  // Name conflicts are an expected wizard answer, not an exception.
  if (status === 409) return { available: false, message }
  throw new Error(message)
}
