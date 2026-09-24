// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The website feedback URL main builds for Settings -> Feedback.
import { describe, expect, it } from 'vitest'
import {
  feedbackUrl,
  isAllowedFeedbackUrl,
  isFeedbackKind,
  osLabel,
  type FeedbackContext
} from '../electron/main/feedback-url'
import type { FeedbackKind } from '../shared/feedback'

const CTX: FeedbackContext = {
  version: '0.2.0-alpha.52',
  build: 'official',
  os: 'windows-11',
  diagRef: null
}

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries())
}

describe('feedbackUrl', () => {
  it('builds the agreed URL shape for each kind', () => {
    for (const kind of ['bug', 'feature', 'question'] as const) {
      const url = feedbackUrl(kind, CTX)
      expect(url.startsWith('https://iblis.meiuxmeiux.com/feedback?')).toBe(true)
      expect(params(url)).toEqual({
        type: kind,
        version: '0.2.0-alpha.52',
        build: 'official',
        os: 'windows-11'
      })
    }
  })

  it('attaches a well-formed diagnostics reference only', () => {
    expect(params(feedbackUrl('bug', { ...CTX, diagRef: 'diag-1a2b3c' })).diag).toBe('diag-1a2b3c')
    expect(params(feedbackUrl('bug', { ...CTX, diagRef: 'diag-1a2b3c&x=1' }))).not.toHaveProperty(
      'diag'
    )
    expect(params(feedbackUrl('bug', { ...CTX, diagRef: '../etc' }))).not.toHaveProperty('diag')
  })

  it('drops a malformed version instead of encoding arbitrary text', () => {
    const url = feedbackUrl('bug', { ...CTX, version: '1.0 <script>' })
    expect(params(url)).not.toHaveProperty('version')
    expect(url).not.toContain('script')
  })

  it('encodes the build-metadata plus sign', () => {
    const url = feedbackUrl('feature', { ...CTX, version: '1.0.0+abc', build: 'source' })
    expect(url).toContain('version=1.0.0%2Babc')
    expect(params(url)).toMatchObject({ version: '1.0.0+abc', build: 'source' })
  })

  it('refuses unknown kinds and any origin but the official site', () => {
    expect(() => feedbackUrl('spam' as FeedbackKind, CTX)).toThrow(/kind/)
    expect(() => feedbackUrl('bug', CTX, 'https://evil.example')).toThrow(/official site/)
    expect(() => feedbackUrl('bug', CTX, 'http://iblis.meiuxmeiux.com')).toThrow(/official site/)
  })
})

describe('isAllowedFeedbackUrl', () => {
  it('allows only https official /feedback without credentials or fragments', () => {
    expect(isAllowedFeedbackUrl('https://iblis.meiuxmeiux.com/feedback?type=bug')).toBe(true)
    expect(isAllowedFeedbackUrl('https://iblis.meiuxmeiux.com/admin')).toBe(false)
    expect(isAllowedFeedbackUrl('https://iblis.meiuxmeiux.com.evil.example/feedback')).toBe(false)
    expect(isAllowedFeedbackUrl('https://user@iblis.meiuxmeiux.com/feedback')).toBe(false)
    expect(isAllowedFeedbackUrl('https://iblis.meiuxmeiux.com:8443/feedback')).toBe(false)
    expect(isAllowedFeedbackUrl('https://iblis.meiuxmeiux.com/feedback#x')).toBe(false)
    expect(isAllowedFeedbackUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedFeedbackUrl('not a url')).toBe(false)
  })
})

describe('helpers', () => {
  it('validates kinds', () => {
    expect(isFeedbackKind('bug')).toBe(true)
    expect(isFeedbackKind('BUG')).toBe(false)
    expect(isFeedbackKind(3)).toBe(false)
  })

  it('labels the operating system', () => {
    expect(osLabel('win32', '10.0.22631')).toBe('windows-11')
    expect(osLabel('win32', '10.0.19045')).toBe('windows-10')
    expect(osLabel('darwin', '23.0.0')).toBe('macos')
    expect(osLabel('linux', '5.15.0')).toBe('linux')
    expect(osLabel('freebsd', '14.0')).toBe('other')
  })
})
