// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Signed and live descriptor handling for engine contract v2. The signed
// descriptor is a hash-verified installed asset (named by the manifest's
// engine.descriptorAsset); the live descriptor comes from the running
// sidecar's GET /v2/descriptor and may only narrow the signed claims. Both go
// through the SDK's strict parsers before anything else trusts them.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_ENGINE_V2_DESCRIPTOR_BYTES,
  engineDescriptorNarrowingErrorsV2,
  parseEngineDescriptorV2,
  type EngineDescriptorV2,
  type PluginManifest
} from '@iblis/plugin-sdk'
import { versionDir } from '../../../plugins/paths'

export interface SignedDescriptorV2 {
  descriptor: EngineDescriptorV2
  // sha256 hex over the exact asset bytes — the identity queued work pins.
  hash: string
}

const signedCache = new Map<string, SignedDescriptorV2>()

export function readSignedDescriptor(
  id: string,
  version: string,
  manifest: PluginManifest
): SignedDescriptorV2 {
  const key = `${id}@${version}`
  const hit = signedCache.get(key)
  if (hit) return hit
  const asset = manifest.engine?.descriptorAsset
  if (!asset) throw new Error(`${id} has no v2 engine descriptor asset`)
  const bytes = readFileSync(join(versionDir(id, version), asset))
  if (bytes.byteLength > MAX_ENGINE_V2_DESCRIPTOR_BYTES) {
    throw new Error('signed engine descriptor exceeds the size cap')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('signed engine descriptor is not valid JSON')
  }
  const result = parseEngineDescriptorV2(parsed)
  if (!result.ok) {
    throw new Error(`signed engine descriptor rejected: ${result.errors[0]}`)
  }
  const value = {
    descriptor: result.value,
    hash: createHash('sha256').update(bytes).digest('hex')
  }
  signedCache.set(key, value)
  return value
}

// Authenticated fetch against the sidecar; the supervisor's requestSidecar
// has this exact shape. Injected so the parser logic tests without a process.
export type DescriptorFetch = (path: string, init?: RequestInit) => Promise<Response>

const LIVE_TIMEOUT_MS = 5000

export async function fetchLiveDescriptor(
  fetchFromSidecar: DescriptorFetch,
  signed: EngineDescriptorV2
): Promise<EngineDescriptorV2> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS)
  try {
    const res = await fetchFromSidecar('/v2/descriptor', { signal: controller.signal })
    if (!res.ok) throw new Error(`engine /v2/descriptor answered HTTP ${res.status}`)
    const text = await res.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_ENGINE_V2_DESCRIPTOR_BYTES) {
      throw new Error('live engine descriptor exceeds the size cap')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('live engine descriptor is not valid JSON')
    }
    const result = parseEngineDescriptorV2(parsed, 'live')
    if (!result.ok) throw new Error(`live engine descriptor rejected: ${result.errors[0]}`)
    const broadened = engineDescriptorNarrowingErrorsV2(signed, result.value)
    if (broadened.length > 0) {
      throw new Error(`live engine descriptor rejected: ${broadened[0]}`)
    }
    return result.value
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('engine /v2/descriptor timed out', { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
  }
}
