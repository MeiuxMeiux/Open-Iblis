// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Shell-side safetensors validation — the third mirror of the strict header
// check in apps/site/src/Trainings/Safetensors.php (server) and the Python
// exporter in packages/plugins/acestep-training (engine). A file is accepted
// only when its 8-byte little-endian header length is sane, the JSON header
// describes nothing but tensors (dtype/shape/data_offsets whose ranges tile
// the data exactly), and the leading bytes are not a pickle/zip container in
// disguise. Runs on every import (dialog, training pull-down, catalog offer)
// before the bytes are admitted to the library — a `.pt`/`.ckpt` renamed to
// `.safetensors`, or a truncated/oversized-header file, never lands.

import { open, stat } from 'node:fs/promises'

const MAX_SAFETENSORS_HEADER_BYTES = 1_048_576n // 1 MiB (matches the PHP/Python mirrors)

// The dtypes the format defines and their element width in bytes; identical
// set to the server + engine mirrors.
const DTYPE_BYTES = new Map<string, bigint>([
  ['F64', 8n],
  ['F32', 4n],
  ['F16', 2n],
  ['BF16', 2n],
  ['I64', 8n],
  ['I32', 4n],
  ['I16', 2n],
  ['I8', 1n],
  ['U8', 1n],
  ['BOOL', 1n],
  ['F8_E4M3', 1n],
  ['F8_E5M2', 1n]
])

// Deepest tensor rank accepted; LoRA weights are rank 1-4 (PHP mirror).
const MAX_RANK = 8

// A tensor name as it may appear in a reason: attacker-chosen, so printable
// ASCII only and short (audit 2026-09-24, M-TRN1; PHP Safetensors::label).
function label(name: string): string {
  const clean = name.slice(0, 256).replace(/[^\x20-\x7E]|'/g, '?')
  return clean.length > 64 ? `${clean.slice(0, 61)}...` : clean
}

// Returns null when the file is a valid safetensors container, else a short
// human-readable reason. Never throws for a malformed file — only the reason
// is surfaced so the caller can reject cleanly.
export async function safetensorsProblem(path: string): Promise<string | null> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return 'file is missing or unreadable'
  }
  if (size < 9) return 'file is missing or too small to be safetensors'

  const fh = await open(path, 'r')
  try {
    const lead = Buffer.alloc(8)
    const { bytesRead } = await fh.read(lead, 0, 8, 0)
    if (bytesRead !== 8) return 'file has no safetensors header'
    // The header length is a full uint64 — read it as a BigInt so a hostile
    // value near 2^63 can't wrap through a 32-bit read.
    const headerLen = lead.readBigUInt64LE(0)
    if (headerLen < 2n || headerLen > MAX_SAFETENSORS_HEADER_BYTES) {
      // .pt/.ckpt come as raw pickle (\x80 protocol byte) or zip ("PK"). Only
      // named once the length is impossible: a real header of 128 bytes also
      // starts with 0x80.
      return lead[0] === 0x80 || (lead[0] === 0x50 && lead[1] === 0x4b)
        ? 'file is a pickle/zip container, not safetensors'
        : 'safetensors header length is out of bounds'
    }
    if (8n + headerLen > BigInt(size)) return 'safetensors header exceeds the file'

    const len = Number(headerLen)
    const headerBuf = Buffer.alloc(len)
    const read = await fh.read(headerBuf, 0, len, 8)
    if (read.bytesRead !== len) return 'safetensors header is truncated'
    let headerJson: string
    try {
      headerJson = new TextDecoder('utf-8', { fatal: true }).decode(headerBuf)
    } catch {
      return 'safetensors header is not valid UTF-8'
    }
    return headerProblem(headerJson, size - 8 - len)
  } finally {
    await fh.close()
  }
}

// JSON.parse reads `2.0` and `2e0` as the integer 2; the format (and the
// server mirror) wants integer literals. The reviver sees each number's source
// text and turns a non-integer literal into NaN, which every check refuses.
type SourceReviver = (key: string, value: unknown, context?: { source?: string }) => unknown
const integerLiterals: SourceReviver = (_key, value, context) =>
  typeof value === 'number' && context?.source !== undefined && !/^-?\d+$/.test(context.source)
    ? Number.NaN
    : value

function headerProblem(headerJson: string, dataBytes: number): string | null {
  let header: unknown
  try {
    header = JSON.parse(headerJson, integerLiterals as Parameters<typeof JSON.parse>[1])
  } catch {
    return 'safetensors header is not valid JSON'
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    return 'safetensors header is not a JSON object'
  }
  const entries = Object.entries(header as Record<string, unknown>)
  if (entries.length === 0) return 'safetensors header is not a JSON object'

  const ranges: [number, number][] = []
  for (const [key, entry] of entries) {
    if (key === '__metadata__') {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return 'safetensors __metadata__ is malformed'
      }
      for (const value of Object.values(entry as Record<string, unknown>)) {
        if (typeof value !== 'string') return 'safetensors __metadata__ values must be strings'
      }
      continue
    }
    const verdict = tensorProblem(label(key), entry, dataBytes)
    if (typeof verdict === 'string') return verdict
    ranges.push(verdict)
  }
  if (ranges.length === 0) return 'safetensors header describes no tensors'
  return layoutProblem(ranges, dataBytes)
}

// Tensors must tile the data buffer exactly, as the reference loader demands:
// in offset order each range starts where the previous one ended, from byte 0
// to the last data byte. No overlap, no hole, no unclaimed tail (audit
// 2026-09-24, M-TRN2 follow-up). A zero-length tensor sits at the cursor.
function layoutProblem(ranges: [number, number][], dataBytes: number): string | null {
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let cursor = 0
  for (const [begin, end] of ranges) {
    if (begin < cursor) return 'safetensors tensors overlap'
    if (begin > cursor) return 'safetensors tensors leave a hole in the data'
    cursor = end
  }
  if (cursor !== dataBytes) return 'safetensors data has bytes no tensor claims'
  return null
}

// One tensor entry: its byte range when valid, else the reason.
function tensorProblem(name: string, entry: unknown, dataBytes: number): string | [number, number] {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return `tensor '${name}' is not an object`
  }
  const rec = entry as Record<string, unknown>
  const keys = Object.keys(rec).sort()
  if (
    keys.length !== 3 ||
    keys[0] !== 'data_offsets' ||
    keys[1] !== 'dtype' ||
    keys[2] !== 'shape'
  ) {
    return `tensor '${name}' does not have exactly dtype/shape/data_offsets`
  }
  const width = typeof rec.dtype === 'string' ? DTYPE_BYTES.get(rec.dtype) : undefined
  if (width === undefined) return `tensor '${name}' has an unsupported dtype`
  const shape = rec.shape
  if (
    !Array.isArray(shape) ||
    shape.length > MAX_RANK ||
    !shape.every((d) => Number.isSafeInteger(d) && (d as number) >= 0)
  ) {
    return `tensor '${name}' has a malformed shape`
  }
  const off = rec.data_offsets
  if (
    !Array.isArray(off) ||
    off.length !== 2 ||
    !Number.isSafeInteger(off[0]) ||
    !Number.isSafeInteger(off[1])
  ) {
    return `tensor '${name}' has malformed data_offsets`
  }
  const [begin, end] = off as [number, number]
  if (begin < 0 || end < begin || end > dataBytes) {
    return `tensor '${name}' has data_offsets outside the file`
  }
  // The range must hold exactly dtype * prod(shape) (audit 2026-09-24, M-TRN2):
  // a loader that sizes its buffer from the shape never reads past the range.
  const want = (shape as number[]).reduce((n, d) => n * BigInt(d), width)
  if (BigInt(end - begin) !== want) {
    return `tensor '${name}' byte range does not match its dtype and shape`
  }
  return [begin, end]
}
