// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { heavyDataRoot } from '../storage'

// Persist the last signature-verified catalog so the Plugins view still has a
// list when the network is down. We store the EXACT signed bytes + signature;
// the cache is re-verified on read, so a tampered cache file is rejected just
// like a tampered network response — the cache is never trusted blindly.
// IBLIS_CATALOG_CACHE_DIR overrides the location for tests.

export type CatalogCacheRoute = 'v1' | 'v2' | 'labs'

function cacheBase(route: CatalogCacheRoute): string {
  const override = process.env.IBLIS_CATALOG_CACHE_DIR
  const dir = override !== undefined && override !== '' ? override : join(heavyDataRoot(), 'cache')
  // Keep route-specific verified pairs separate. An offline cloud-capable host
  // must never mistake a legacy, adapter-free list for its selected route.
  return join(dir, `catalog-${route}`)
}

export function writeCatalogCache(
  route: CatalogCacheRoute,
  jsonBytes: Buffer,
  signature: string
): void {
  const base = cacheBase(route)
  mkdirSync(dirname(base), { recursive: true })
  writeFileSync(`${base}.json`, jsonBytes)
  writeFileSync(`${base}.json.sig`, signature)
}

export function readCatalogCache(
  route: CatalogCacheRoute
): { jsonBytes: Buffer; signature: string } | null {
  try {
    const base = cacheBase(route)
    return {
      jsonBytes: readFileSync(`${base}.json`),
      signature: readFileSync(`${base}.json.sig`, 'utf8')
    }
  } catch {
    return null
  }
}
