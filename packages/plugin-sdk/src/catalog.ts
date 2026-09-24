// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: Apache-2.0

import type { PluginManifest } from './manifest.js'

// The signed catalog: the trust root for plugins. Lives at
// https://iblis.meiuxmeiux.com/api/v1/catalog.json with an Ed25519 signature
// at catalog.json.sig (raw base64 over the exact catalog.json bytes). The
// shell verifies the signature against the baked-in public key BEFORE reading
// any entry. Signature verification itself lives in the shell (it needs
// node:crypto + the public key); this package defines the shape + constants.

export const CATALOG_SCHEMA_VERSION = 1

export type ReleaseChannel = 'stable' | 'beta'

export interface CatalogEntry {
  manifest: PluginManifest
  channel?: ReleaseChannel // defaults to "stable"
  publishedAt?: string // ISO 8601
}

export interface Catalog {
  schemaVersion: number
  generatedAt: string // ISO 8601
  plugins: CatalogEntry[]
}
