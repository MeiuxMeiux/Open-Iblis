// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { parseCatalog, type Catalog } from '@iblis/plugin-sdk'
import { ok, err, type IpcResult } from '../../../shared/contract'
import { log } from '../logger'
import { fetchBytes, fetchText } from './fetch'
import { verifyCatalogSignature } from './verify'
import { writeCatalogCache, readCatalogCache } from './cache'
import { errorMessage } from '../error-message'
import { catalogBase, type CatalogRoute } from '../official-endpoints'

// Fetch -> verify signature -> validate shape. Order matters: the signature is
// checked over the exact bytes BEFORE the JSON is trusted or parsed. The last
// verified catalog is cached so a later offline launch still has a plugin list.

// v1 remains permanently consumable by alpha.33. Hosts that understand the
// declarative cloud-provider kind opt into the separately signed v2 route.
// The base comes from official-endpoints.ts (IBLIS_CATALOG_BASE points dev and
// tests at a local server); the signature check guards either way.

// Verify the signature over the EXACT bytes, then (only if good) parse + validate.
function verifyAndParse(
  jsonBytes: Buffer,
  signature: string,
  pubKeyPem: string | undefined,
  origin: string
): IpcResult<Catalog> {
  if (!verifyCatalogSignature(jsonBytes, signature, pubKeyPem)) {
    log('error', 'catalog signature verification failed', { origin })
    return err('catalog signature verification failed')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonBytes.toString('utf8'))
  } catch {
    return err('catalog is not valid JSON')
  }

  const res = parseCatalog(parsed)
  if (!res.ok) return err(`catalog failed validation: ${res.errors.join('; ')}`)
  return ok(res.value)
}

export async function loadCatalog(
  opts: { pubKeyPem?: string; route?: CatalogRoute } = {}
): Promise<IpcResult<Catalog>> {
  const route = opts.route ?? 'v2'
  const base = catalogBase(route)

  let jsonBytes: Buffer
  let signature: string
  try {
    ;[jsonBytes, signature] = await Promise.all([
      fetchBytes(`${base}/catalog.json`),
      fetchText(`${base}/catalog.json.sig`)
    ])
  } catch (e) {
    // Network down: fall back to the last verified catalog if we have one. It is
    // re-verified before use, so a stale-but-valid list is the worst outcome.
    const cached = readCatalogCache(route)
    if (cached) {
      const res = verifyAndParse(cached.jsonBytes, cached.signature, opts.pubKeyPem, 'cache')
      if (res.ok) {
        log('warn', 'catalog served from cache (network unavailable)', {
          plugins: res.data.plugins.length
        })
        return res
      }
    }
    return err(`catalog fetch failed: ${errorMessage(e)}`)
  }

  const res = verifyAndParse(jsonBytes, signature, opts.pubKeyPem, base)
  if (res.ok) {
    writeCatalogCache(route, jsonBytes, signature)
    log('info', 'catalog loaded', { plugins: res.data.plugins.length, base, route })
  }
  return res
}
