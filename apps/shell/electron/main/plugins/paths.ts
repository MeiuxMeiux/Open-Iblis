// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { join } from 'node:path'
import { heavyDataRoot } from '../storage'

// On-disk layout (see docs/feature/plugins.md "Lifecycle"):
//   <root>/<id>/current.txt   active version string
//   <root>/<id>/<version>/    installed asset tree
// IBLIS_PLUGINS_DIR overrides the root for tests.

export function pluginsRoot(): string {
  const override = process.env.IBLIS_PLUGINS_DIR
  if (override) return override // an empty value falls back to the default
  return join(heavyDataRoot(), 'plugins')
}

// A plugin id or version becomes one directory name. Renderer-supplied ids
// reach here (plugins:remove / plugins:rollback), so anything that is not a
// single plain segment is refused before it can touch the filesystem: no
// separators, no drive colon, no `..` (security audit 2026-09-24, M-SHL1 - a
// crafted id used to recursively delete an arbitrary folder). Every catalog
// id (reverse-DNS) and SemVer version fits this shape.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/

export function isSafeSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value) && !value.includes('..')
}

function assertSafeSegment(value: string, what: string): string {
  if (!isSafeSegment(value)) {
    throw new Error(`invalid plugin ${what}`)
  }
  return value
}

export function pluginDir(id: string): string {
  return join(pluginsRoot(), assertSafeSegment(id, 'id'))
}

export function versionDir(id: string, version: string): string {
  return join(pluginDir(id), assertSafeSegment(version, 'version'))
}

export function pointerPath(id: string): string {
  return join(pluginDir(id), 'current.txt')
}
