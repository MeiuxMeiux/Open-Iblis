// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Security audit 2026-09-24: external links are https-only (M-SHL2), the
// window never leaves its document (M-SHL3), and the dev-server override is
// ignored in packaged builds (L-SHL7).
import { describe, expect, it } from 'vitest'
import {
  externalUrlAllowed,
  rendererDevUrl,
  sameDocument
} from '../electron/main/navigation-policy'

describe('externalUrlAllowed', () => {
  it('opens only https links', () => {
    expect(externalUrlAllowed('https://iblis.meiuxmeiux.com/terms')).toBe(true)
    for (const url of [
      'http://example.com',
      'file:///C:/Users/x/Downloads/a.exe',
      'file://attacker/share/x.exe',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'javascript:alert(1)',
      'not a url'
    ]) {
      expect(externalUrlAllowed(url)).toBe(false)
    }
  })
})

describe('sameDocument', () => {
  const current = 'file:///C:/Program%20Files/Iblis/resources/app.asar/out/renderer/index.html'
  it('allows a reload or fragment change of the current document', () => {
    expect(sameDocument(current, current)).toBe(true)
    expect(sameDocument(`${current}#library`, current)).toBe(true)
  })
  it('refuses any other document', () => {
    expect(sameDocument('file:///C:/Users/x/Downloads/evil.html', current)).toBe(false)
    expect(sameDocument('https://evil.example/', current)).toBe(false)
    expect(sameDocument('garbage', current)).toBe(false)
  })
})

describe('rendererDevUrl', () => {
  it('honors ELECTRON_RENDERER_URL only in unpackaged builds', () => {
    const env = { ELECTRON_RENDERER_URL: 'http://localhost:5173' }
    expect(rendererDevUrl(env, false)).toBe('http://localhost:5173')
    expect(rendererDevUrl(env, true)).toBeNull()
    expect(rendererDevUrl({}, false)).toBeNull()
    expect(rendererDevUrl({ ELECTRON_RENDERER_URL: '' }, false)).toBeNull()
  })
})
