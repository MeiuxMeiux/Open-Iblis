// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Redaction for diagnostics bundles. DOM-free + pure so it is the high-value
// unit-test surface (see redact.test.ts). Applied to every string that leaves
// the machine, at every consent tier, BEFORE upload. See docs/feature/
// diagnostics.md "Redaction".

import type { DiagLevel } from '../../../shared/contract'

export type { DiagLevel }

// C:\Users\alice\… -> C:\Users\<user>\…   and  /home/alice -> /home/<user>
// The separator may also be a JSON-escaped double backslash: log files are
// JSON lines, so a path in main.log reads C:\\Users\\alice (audit 2026-09-24,
// M-DIAG2 - the single-separator form let every logged Windows path through).
const WIN_USER = /([A-Za-z]:(?:\\\\|[\\/])Users(?:\\\\|[\\/]))[^\\/\r\n"']+/gi
const NIX_USER = /(\/(?:home|Users)\/)[^/\r\n"']+/gi
// Drop signed-URL query strings (GCS/HF tokens land here).
const URL_QUERY = /(https?:\/\/[^\s"'<>]+?)\?[^\s"'<>]+/gi
// Authorization: Bearer <token> and the session-secret header value.
const BEARER = /(Bearer\s+)\S+/gi
const SESSION = /(X-Iblis-Session["':\s]+)\S+/gi
// Bare credentials that could land in a log line without a "Bearer " prefix:
// OpenAI/OpenRouter-style sk-… keys and Hugging Face hf_… tokens.
const BARE_KEY = /\b(?:sk|hf)[-_][A-Za-z0-9_-]{8,}\b/g
// Iblis product keys and entitlement leases (base64url.base64url, also the JWT
// shape). Nothing logs them today; this keeps a future slip out of a bundle
// (audit 2026-09-24, L-DIAG3). The masked form IBLIS-****-… never matches.
const PRODUCT_KEY = /\bIBLIS(?:-[0-9A-Z]{4}){4}\b/gi
const LEASE_LIKE = /\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}\b/g

// Redact a single string: usernames in paths, signed-URL queries, and secrets.
// Safe to run repeatedly and on arbitrary log text.
export function redactText(input: string): string {
  return input
    .replace(WIN_USER, '$1<user>')
    .replace(NIX_USER, '$1<user>')
    .replace(URL_QUERY, '$1?<redacted>')
    .replace(BEARER, '$1<redacted>')
    .replace(SESSION, '$1<redacted>')
    .replace(BARE_KEY, '<redacted>')
    .replace(PRODUCT_KEY, '<redacted>')
    .replace(LEASE_LIKE, '<redacted>')
}

// Keys whose values are user content — dropped entirely below `verbose`.
const CONTENT_KEYS = new Set([
  'prompt',
  'lyrics',
  'caption',
  'note',
  'filename',
  'fileName',
  'title'
])

// The same user-content keys inside free text: log tails are JSON lines, so a
// prompt logged as {"prompt":"..."} is a string here, not an object key.
const INLINE_CONTENT =
  /("(?:prompt|lyrics|caption|note|filename|fileName|title)"\s*:\s*)"(?:[^"\\]|\\.)*"/g

// Recursively redact a JSON-ish value. At the `errors` tier, user-content keys
// are replaced with "<omitted>"; at `verbose` they are kept (but still text-
// redacted for paths/secrets). `off` should never reach here (no bundle built).
export function redactValue(value: unknown, level: DiagLevel): unknown {
  if (typeof value === 'string') {
    const text = redactText(value)
    return level === 'verbose' ? text : text.replace(INLINE_CONTENT, '$1"<omitted>"')
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, level))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (level !== 'verbose' && CONTENT_KEYS.has(k)) {
        out[k] = '<omitted>'
      } else {
        out[k] = redactValue(v, level)
      }
    }
    return out
  }
  return value
}
