// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Caller headers plus one credential header this module owns. Accepts every
// HeadersInit shape (object, pairs, Headers); a spread would mangle the last
// two. The credential is set last, so a caller can never override it.
export function withCredentialHeader(
  init: RequestInit['headers'],
  name: string,
  value: string
): Headers {
  const headers = new Headers(init)
  headers.set(name, value)
  return headers
}
