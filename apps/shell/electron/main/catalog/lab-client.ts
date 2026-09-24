// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { parseLabCatalog, type Catalog } from '@iblis/plugin-sdk'
import { err, ok, type IpcResult } from '../../../shared/contract'
import { log } from '../logger'
import { readCatalogCache, writeCatalogCache } from './cache'
import { fetchBytes, fetchText } from './fetch'
import { verifyCatalogSignature } from './verify'
import { errorMessage } from '../error-message'
import { NotConfiguredError, serviceEndpoint } from '../official-endpoints'

// Labs are an opt-in build channel, not a runtime product-key switch. A normal
// production build therefore never asks for this feed, even if a local lease
// happens to carry the labs feature. The future private signing public key is
// injected only into a reviewed lab build; its private counterpart remains
// outside the repository.
const LABS_CHANNEL_ENABLED = process.env.IBLIS_LABS_ENABLED === 'true'
const LAB_CATALOG_PUBKEY_PEM = process.env.IBLIS_LAB_CATALOG_PUBKEY ?? ''

export interface LoadLabCatalogOptions {
  enabled?: boolean
  lease?: string | null
  pubKeyPem?: string
}

function verifyAndParseLabCatalog(
  jsonBytes: Buffer,
  signature: string,
  pubKeyPem: string,
  origin: string
): IpcResult<Catalog> {
  if (!verifyCatalogSignature(jsonBytes, signature, pubKeyPem)) {
    log('error', 'lab catalog signature verification failed', { origin })
    return err('lab catalog signature verification failed')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonBytes.toString('utf8'))
  } catch {
    return err('lab catalog is not valid JSON')
  }
  const result = parseLabCatalog(parsed)
  if (!result.ok) return err(`lab catalog failed validation: ${result.errors.join('; ')}`)
  return ok(result.value)
}

// This function is main-process only. Callers must obtain the lease from the
// licensing service; the renderer never sees that credential, asset URLs, or
// lab cache paths. No installation path exists in this delivery slice.
export async function loadLabCatalog(
  options: LoadLabCatalogOptions = {}
): Promise<IpcResult<Catalog>> {
  if (!(options.enabled ?? LABS_CHANNEL_ENABLED)) {
    return err('private processor labs are not enabled in this build')
  }
  if (!options.lease) return err('a current labs entitlement is required')
  const pubKeyPem = options.pubKeyPem ?? LAB_CATALOG_PUBKEY_PEM
  if (!pubKeyPem.trim()) return err('private processor lab signing key is not configured')

  const base = serviceEndpoint('labs')
  if (base === null) return err(new NotConfiguredError('labs').message)
  const headers = { 'X-Iblis-Lease': options.lease }
  let jsonBytes: Buffer
  let signature: string
  try {
    ;[jsonBytes, signature] = await Promise.all([
      fetchBytes(`${base}/catalog.json`, headers),
      fetchText(`${base}/catalog.json.sig`, headers)
    ])
  } catch (error) {
    const cached = readCatalogCache('labs')
    if (cached) {
      const result = verifyAndParseLabCatalog(
        cached.jsonBytes,
        cached.signature,
        pubKeyPem,
        'cache'
      )
      if (result.ok) {
        log('warn', 'lab catalog served from cache (network unavailable)', {
          plugins: result.data.plugins.length
        })
        return result
      }
    }
    return err(`lab catalog fetch failed: ${errorMessage(error)}`)
  }

  const result = verifyAndParseLabCatalog(jsonBytes, signature, pubKeyPem, base)
  if (result.ok) {
    writeCatalogCache('labs', jsonBytes, signature)
    log('info', 'lab catalog loaded', { plugins: result.data.plugins.length, base })
  }
  return result
}
