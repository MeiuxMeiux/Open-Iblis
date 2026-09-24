// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect } from 'vitest'
import { redactText, redactValue } from '../electron/main/diag/redact'

describe('redactText', () => {
  it('strips the OS username from Windows + POSIX paths', () => {
    expect(redactText('C:\\Users\\alice\\AppData\\Roaming\\Iblis')).toBe(
      'C:\\Users\\<user>\\AppData\\Roaming\\Iblis'
    )
    expect(redactText('/home/cassandra/.config')).toBe('/home/<user>/.config')
    expect(redactText('/Users/alice/Library')).toBe('/Users/<user>/Library')
  })

  it('drops signed-URL query strings but keeps the path', () => {
    expect(
      redactText('GET https://storage.googleapis.com/iblis-dist/x.exe?X-Goog-Signature=abc123')
    ).toBe('GET https://storage.googleapis.com/iblis-dist/x.exe?<redacted>')
  })

  it('redacts bearer tokens and the session secret', () => {
    expect(redactText('Authorization: Bearer test-token-0123456789abcdef')).toBe(
      'Authorization: Bearer <redacted>'
    )
    expect(redactText('X-Iblis-Session: 3f9a-deadbeef')).toContain('<redacted>')
  })

  it('redacts bare provider keys without a Bearer prefix', () => {
    expect(redactText('saved key sk-or-v1-0123456789abcdef0123456789abcdef')).toBe(
      'saved key <redacted>'
    )
    expect(redactText('token hf_AbCdEfGhIjKlMnOpQrStUv')).toBe('token <redacted>')
    expect(redactText('a risky skate move')).toBe('a risky skate move')
  })

  it('is idempotent', () => {
    const once = redactText('C:\\Users\\alice\\f')
    expect(redactText(once)).toBe(once)
  })
})

describe('redactValue', () => {
  it('omits user-content keys below verbose', () => {
    expect(redactValue({ prompt: 'a sad song', seed: 42 }, 'errors')).toEqual({
      prompt: '<omitted>',
      seed: 42
    })
  })

  it('keeps user-content keys at verbose (still path/secret redacted elsewhere)', () => {
    expect(redactValue({ prompt: 'a sad song', path: 'C:\\Users\\alice\\x' }, 'verbose')).toEqual({
      prompt: 'a sad song',
      path: 'C:\\Users\\<user>\\x'
    })
  })

  // Audit 2026-09-24 M-DIAG2: log files are JSON lines, so separators are
  // escaped double backslashes.
  it('strips the username from JSON-escaped Windows paths in log lines', () => {
    const line = JSON.stringify({ path: 'C:\\Users\\alice\\AppData\\x.log' })
    expect(redactText(line)).toBe('{"path":"C:\\\\Users\\\\<user>\\\\AppData\\\\x.log"}')
    expect(redactText(line)).not.toContain('alice')
  })

  // L-DIAG3: product keys, leases, and inline user content in log text.
  it('redacts product keys and lease-shaped tokens but keeps the masked key', () => {
    expect(redactText('key IBLIS-AAAA-CD34-EF56-GH78 typed')).toBe('key <redacted> typed')
    expect(redactText('IBLIS-****-****-****-GH78')).toBe('IBLIS-****-****-****-GH78')
    const lease = `${'a'.repeat(300)}.${'b'.repeat(86)}`
    expect(redactText(`lease=${lease}`)).toBe('lease=<redacted>')
  })

  it('omits user content inside JSON log lines below verbose only', () => {
    const line = '{"msg":"enqueue","prompt":"my \\"secret\\" song","n":1}'
    expect(redactValue(line, 'errors')).toBe('{"msg":"enqueue","prompt":"<omitted>","n":1}')
    expect(redactValue(line, 'verbose')).toBe(line)
  })

  it('recurses through arrays and nested objects', () => {
    expect(redactValue({ events: [{ note: 'secret', n: 1 }] }, 'errors')).toEqual({
      events: [{ note: '<omitted>', n: 1 }]
    })
  })
})
