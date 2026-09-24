// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict'
// SHA-256 + byte count of a file on disk. The catalog records both so the
// shell can verify each downloaded asset before trusting it. Hashing is
// synchronous but chunked, so multi-GB pack archives never materialize as a
// single Buffer (readFileSync caps out at 2 GiB).
const { createHash } = require('node:crypto')
const { openSync, readSync, closeSync } = require('node:fs')

function sha256File(absPath) {
  const hash = createHash('sha256')
  const chunk = Buffer.alloc(8 * 1024 * 1024)
  const fd = openSync(absPath, 'r')
  let bytes = 0
  try {
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null)
      if (read === 0) break
      bytes += read
      hash.update(chunk.subarray(0, read))
    }
  } finally {
    closeSync(fd)
  }
  return { sha256: hash.digest('hex'), bytes }
}

module.exports = { sha256File }
