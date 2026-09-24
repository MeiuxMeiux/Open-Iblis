// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Per-entry gate for archive assets (security audit 2026-09-24, L-SHL10).
// extract-zip refuses entries whose parent resolves outside the target, but it
// creates symlink entries verbatim (GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3,
// no patched release): a link to an outside path followed by an entry written
// through it lands outside the staging tree. Archives are sha256-pinned by the
// signed catalog, so this is defence in depth against a poisoned upstream zip.

export interface ZipEntryLike {
  fileName: string
  externalFileAttributes: number
}

const S_IFMT = 0o170000
const S_IFLNK = 0o120000
// NTFS alternate data streams and characters Windows refuses in names, plus
// the reserved device names in any path segment.
const BAD_CHARS = /[:<>|?*\\\0]/
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i

export function assertSafeZipEntry(entry: ZipEntryLike): void {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff
  if ((mode & S_IFMT) === S_IFLNK) {
    throw new Error(`archive entry ${JSON.stringify(entry.fileName)} is a symlink`)
  }
  const name = entry.fileName
  const segments = name.split('/').filter((s) => s !== '')
  if (
    name.startsWith('/') ||
    BAD_CHARS.test(name) ||
    segments.some((s) => s === '..' || RESERVED.test(s))
  ) {
    throw new Error(`archive entry ${JSON.stringify(name)} has an unsafe name`)
  }
}
