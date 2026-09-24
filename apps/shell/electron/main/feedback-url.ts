// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Builds the website feedback URL. The renderer sends only a kind and a
// checkbox; main fills every other value from what it already knows (app
// version, build kind, OS, the latest diagnostics reference) and refuses any
// result that is not the official /feedback page. Wiring: ipc-feedback.ts.

import { FEEDBACK_KINDS, type FeedbackKind } from '../../shared/feedback'
import { OFFICIAL_SITE_ORIGIN, siteOrigin, type BuildKind } from './official-endpoints'

const FEEDBACK_PATH = '/feedback'
const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/
// Server refs look like diag-1a2b3c (apps/site diag endpoint).
const DIAG_REF_RE = /^diag-[0-9a-f]{6,64}$/

type OsLabel = 'windows-11' | 'windows-10' | 'macos' | 'linux' | 'other'

export interface FeedbackContext {
  version: string
  build: BuildKind
  os: OsLabel
  diagRef: string | null
}

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === 'string' && (FEEDBACK_KINDS as readonly string[]).includes(value)
}

// Windows 11 still reports NT 10.0; its build number starts at 22000.
export function osLabel(platform: string, osRelease: string): OsLabel {
  if (platform === 'win32') {
    const build = Number(osRelease.split('.')[2] ?? 0)
    return build >= 22000 ? 'windows-11' : 'windows-10'
  }
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  return 'other'
}

// Only the official site's /feedback page over https, with no credentials,
// port, or fragment. Checked on the finished URL as the last step before
// shell.openExternal, so a bug upstream cannot open anything else.
export function isAllowedFeedbackUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.origin === OFFICIAL_SITE_ORIGIN &&
    url.username === '' &&
    url.password === '' &&
    url.hash === '' &&
    url.pathname === FEEDBACK_PATH
  )
}

export function feedbackUrl(
  kind: FeedbackKind,
  ctx: FeedbackContext,
  origin: string = siteOrigin()
): string {
  if (!isFeedbackKind(kind)) throw new Error('unknown feedback kind')
  const url = new URL(FEEDBACK_PATH, origin)
  // Values are validated, then URLSearchParams encodes them. Nothing
  // free-form (a note, a path, a prompt) ever enters the URL.
  url.searchParams.set('type', kind)
  if (VERSION_RE.test(ctx.version)) url.searchParams.set('version', ctx.version)
  url.searchParams.set('build', ctx.build)
  url.searchParams.set('os', ctx.os)
  if (ctx.diagRef !== null && DIAG_REF_RE.test(ctx.diagRef)) {
    url.searchParams.set('diag', ctx.diagRef)
  }
  const href = url.toString()
  if (!isAllowedFeedbackUrl(href)) throw new Error('feedback URL is not on the official site')
  return href
}
