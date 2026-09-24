// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { join, normalize, isAbsolute, sep } from 'node:path'
import { parseSkinDescriptor } from '@iblis/plugin-sdk'
import type { InstalledSkin } from '../../../shared/contract'
import { versionDir } from './paths'
import { listInstalled } from './registry'
import { readInstalledManifest } from './installed-manifest'
import { log } from '../logger'

// Resolve installed `kind:"skin"` plugins into descriptors the renderer can
// apply. A skin plugin ships a `skin.json` (a SkinDescriptor) asset and,
// optionally, an `extras.css`. This reads + validates the descriptor of each
// skin's ACTIVE version off disk (the bytes were SHA-256-pinned at install) and
// returns the token map plus the extras.css text. Skins never spawn a process,
// so there is no sidecar path here — only file reads within the version folder.

const MAX_CSS_BYTES = 64 * 1024 // generous; the doc caps extras.css at ~150 LOC

// Read a file that MUST live inside the plugin's version folder. Returns null on
// any traversal attempt or read failure — a malformed skin must not crash main.
function readWithin(dir: string, rel: string): string | null {
  if (isAbsolute(rel)) return null
  const full = normalize(join(dir, rel))
  if (full !== dir && !full.startsWith(dir + sep)) return null // escaped the folder
  try {
    return readFileSync(full, 'utf8')
  } catch {
    return null
  }
}

// extras.css is author-provided; we inject it as <style> text content (HTML-safe
// since it is never parsed as HTML). Still strip @import so a skin can't pull in
// remote stylesheets — forbidden by docs/feature/skins.md "What skins must NOT do".
function sanitizeExtrasCss(css: string): string {
  return css.slice(0, MAX_CSS_BYTES).replace(/@import[^;]*;/gi, '/* remote import stripped */')
}

export function readInstalledSkins(): InstalledSkin[] {
  const out: InstalledSkin[] = []
  for (const plugin of listInstalled()) {
    if (!plugin.activeVersion) continue
    const manifest = readInstalledManifest(plugin.id, plugin.activeVersion)
    if (manifest?.kind !== 'skin') continue

    const dir = versionDir(plugin.id, plugin.activeVersion)
    // The descriptor is the manifest asset named skin.json, else the first .json.
    const descPath =
      manifest.assets.find((a) => a.path === 'skin.json')?.path ??
      manifest.assets.find((a) => a.path.endsWith('.json'))?.path
    if (!descPath) continue

    const raw = readWithin(dir, descPath)
    if (raw == null) {
      log('warn', 'skin descriptor unreadable', { id: plugin.id })
      continue
    }
    let parsed
    try {
      parsed = parseSkinDescriptor(JSON.parse(raw), `${plugin.id}/skin.json`)
    } catch {
      parsed = { ok: false as const, errors: ['descriptor is not valid JSON'] }
    }
    if (!parsed.ok) {
      log('warn', 'skin descriptor invalid', { id: plugin.id, errors: parsed.errors })
      continue
    }
    const d = parsed.value

    const skin: InstalledSkin = {
      id: manifest.id, // the plugin id is the picker/data-skin id (stable, removable)
      name: d.name,
      version: manifest.version,
      tokens: d.tokens
    }
    if (d.theme) skin.theme = d.theme
    if (d.extends) skin.extends = d.extends
    if (d.css) {
      const css = readWithin(dir, d.css)
      if (css != null) skin.css = sanitizeExtrasCss(css)
      else log('warn', 'skin extras.css unreadable', { id: plugin.id, css: d.css })
    }
    out.push(skin)
  }
  return out
}
