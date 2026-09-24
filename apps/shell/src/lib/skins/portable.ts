// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// .iblis-skin export/import — turn the active skin's per-skin token overrides
// into a portable, shareable descriptor and back again (see feature/skins.md
// "In-app editor"). A `.iblis-skin` file is a JSON `SkinDescriptor`: a base
// skin id (`extends`) plus the overridden tokens. That is exactly what the
// editor produces — no extras.css / cover, so no zip and no new dependency.
// (The zip-with-extras form arrives with skins-as-signed-plugins.)
//
// Pure values + validation only — no Svelte/DOM imports, so it unit-tests
// under the node environment like skins.ts and editor.ts.

import type { SkinDescriptor } from '@iblis/plugin-sdk'
import { SKINS, resolveSkin } from './skins'
import { sanitizeOverrides, type SkinOverrides } from './editor'

export const SKIN_FILE_EXT = '.iblis-skin'
const DEFAULT_VERSION = '1.0.0'

const skinById = (id: string) => SKINS.find((s) => s.id === id)

/** Slug-safe filename for a descriptor, e.g. "infernal-custom.iblis-skin". */
export function skinFileName(idOrName: string): string {
  const slug =
    idOrName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skin'
  return `${slug}${SKIN_FILE_EXT}`
}

export interface BuildOpts {
  id?: string
  name?: string
  version?: string
}

/**
 * Build a portable descriptor from a base skin id + its current override map.
 * The base skin is recorded as `extends`; only contract tokens are kept.
 */
export function buildDescriptor(
  baseSkinId: string,
  overrides: SkinOverrides,
  opts: BuildOpts = {}
): SkinDescriptor {
  const base = skinById(baseSkinId)
  const descriptor: SkinDescriptor = {
    id: opts.id ?? `iblis.skin.${baseSkinId}.custom`,
    name: opts.name ?? (base ? `${base.name} (custom)` : baseSkinId),
    version: opts.version ?? DEFAULT_VERSION,
    extends: baseSkinId,
    tokens: sanitizeOverrides(overrides)
  }
  if (base) descriptor.theme = base.theme
  return descriptor
}

/** Serialise a descriptor to the `.iblis-skin` file body (pretty JSON). */
export function serializeSkin(descriptor: SkinDescriptor): string {
  return JSON.stringify(descriptor, null, 2) + '\n'
}

interface ParsedSkin {
  descriptor: SkinDescriptor
  /** A known built-in skin id to apply the tokens onto (resolved/fallback). */
  baseSkinId: string
  /** The descriptor's tokens, sanitised to the contract. */
  overrides: SkinOverrides
  /** Token keys that were present but ignored (not in the contract). */
  droppedTokens: string[]
  /** True when `extends` named an unknown skin and we fell back to default. */
  baseFellBack: boolean
}

export type ParseResult = { ok: true; skin: ParsedSkin } | { ok: false; error: string }

/**
 * Parse + validate the body of a `.iblis-skin` file. Lenient by design: any
 * recognised contract tokens are kept, unknown ones reported, and a missing or
 * unknown `extends` falls back to the default skin so the import still applies.
 */
export function parseSkinFile(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Not a valid .iblis-skin file (could not parse JSON).' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Not a valid skin descriptor.' }
  }

  const obj = raw as Record<string, unknown>
  const rawTokens =
    obj.tokens && typeof obj.tokens === 'object' && !Array.isArray(obj.tokens)
      ? (obj.tokens as Record<string, unknown>)
      : {}
  const overrides = sanitizeOverrides(rawTokens)
  const kept = new Set(Object.keys(overrides))
  const droppedTokens = Object.keys(rawTokens).filter((k) => !kept.has(k))

  if (Object.keys(overrides).length === 0) {
    return { ok: false, error: 'No recognised skin tokens in this file.' }
  }

  const wantBase = typeof obj.extends === 'string' ? obj.extends : ''
  const baseSkinId = resolveSkin(wantBase)
  const baseFellBack = !!wantBase && baseSkinId !== wantBase

  const descriptor: SkinDescriptor = {
    id: typeof obj.id === 'string' && obj.id ? obj.id : `${baseSkinId}.imported`,
    name: typeof obj.name === 'string' && obj.name ? obj.name : 'Imported skin',
    version: typeof obj.version === 'string' && obj.version ? obj.version : DEFAULT_VERSION,
    extends: baseSkinId,
    tokens: overrides
  }
  const base = skinById(baseSkinId)
  if (base) descriptor.theme = base.theme

  return { ok: true, skin: { descriptor, baseSkinId, overrides, droppedTokens, baseFellBack } }
}
