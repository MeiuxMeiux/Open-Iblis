// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Security audit 2026-09-24 L-SHL10: archive entries that extract-zip would
// create verbatim (symlinks) or that Windows would misread are refused.
import { describe, expect, it } from 'vitest'
import { assertSafeZipEntry } from '../electron/main/plugins/zip-guard'

const FILE = (0o100644 << 16) >>> 0
const DIR = (0o040755 << 16) >>> 0
const LINK = (0o120777 << 16) >>> 0

describe('assertSafeZipEntry', () => {
  it('accepts ordinary files and directories', () => {
    expect(() =>
      assertSafeZipEntry({ fileName: 'runtime/bin/python.exe', externalFileAttributes: FILE })
    ).not.toThrow()
    expect(() =>
      assertSafeZipEntry({ fileName: 'runtime/lib/', externalFileAttributes: DIR })
    ).not.toThrow()
    // DOS-created zips carry no Unix mode at all.
    expect(() =>
      assertSafeZipEntry({ fileName: 'a/b.txt', externalFileAttributes: 0x20 })
    ).not.toThrow()
  })

  it('refuses symlink entries', () => {
    expect(() =>
      assertSafeZipEntry({ fileName: 'runtime/escape', externalFileAttributes: LINK })
    ).toThrow(/symlink/)
  })

  it('refuses traversal, absolute, stream, and reserved names', () => {
    for (const fileName of [
      '../x',
      'a/../../x',
      '/etc/x',
      'a/b:stream',
      'a\\b',
      'x/CON',
      'x/nul.txt',
      'LPT1'
    ]) {
      expect(() => assertSafeZipEntry({ fileName, externalFileAttributes: FILE })).toThrow(
        /unsafe name/
      )
    }
  })
})
