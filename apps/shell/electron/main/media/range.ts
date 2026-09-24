// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Pure HTTP byte-range planning for the local media protocol. Chromium asks
// for one range at a time; unsupported units and multi-range requests fall
// back to a full response instead of inventing multipart/byteranges support.

export type ByteRangeDecision =
  { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'unsatisfiable' }

export interface MediaResponsePlan {
  status: 200 | 206 | 405 | 416
  headers: Record<string, string>
  read?: { start: number; end: number }
}

function validSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`invalid media size ${size}`)
}

export function parseByteRange(value: string | null, size: number): ByteRangeDecision {
  validSize(size)
  if (value === null) return { kind: 'full' }

  const trimmed = value.trim()
  const equals = trimmed.indexOf('=')
  if (equals === -1) return { kind: 'full' }
  const unit = trimmed.slice(0, equals).trim().toLowerCase()
  if (unit !== 'bytes') return { kind: 'full' }
  const spec = trimmed.slice(equals + 1).trim()
  if (spec.includes(',')) return { kind: 'full' }

  const match = /^(\d*)-(\d*)$/.exec(spec)
  if (!match) return { kind: 'unsatisfiable' }
  // Both groups always participate; the defaults only satisfy the index type.
  const [, first = '', second = ''] = match
  if (!first && !second) return { kind: 'unsatisfiable' }
  const total = BigInt(size)
  if (total === 0n) return { kind: 'unsatisfiable' }

  if (!first) {
    const suffix = BigInt(second)
    if (suffix <= 0n) return { kind: 'unsatisfiable' }
    const start = suffix >= total ? 0n : total - suffix
    return { kind: 'partial', start: Number(start), end: size - 1 }
  }

  const start = BigInt(first)
  if (start >= total) return { kind: 'unsatisfiable' }
  if (!second) return { kind: 'partial', start: Number(start), end: size - 1 }

  const requestedEnd = BigInt(second)
  if (requestedEnd < start) return { kind: 'unsatisfiable' }
  const end = requestedEnd >= total ? total - 1n : requestedEnd
  return { kind: 'partial', start: Number(start), end: Number(end) }
}

export function planMediaResponse(input: {
  method: string
  range: string | null
  size: number
  mime: string
}): MediaResponsePlan {
  validSize(input.size)
  const method = input.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Content-Length': '0' }
    }
  }

  const base = {
    'Accept-Ranges': 'bytes',
    'Content-Type': input.mime
  }
  // Range applies to GET. HEAD reports the headers a full GET would return and
  // never opens the file body.
  const decision =
    method === 'HEAD' ? { kind: 'full' as const } : parseByteRange(input.range, input.size)

  if (decision.kind === 'unsatisfiable') {
    return {
      status: 416,
      headers: {
        ...base,
        'Content-Length': '0',
        'Content-Range': `bytes */${input.size}`
      }
    }
  }

  if (decision.kind === 'partial') {
    const length = decision.end - decision.start + 1
    return {
      status: 206,
      headers: {
        ...base,
        'Content-Length': String(length),
        'Content-Range': `bytes ${decision.start}-${decision.end}/${input.size}`
      },
      ...(method === 'GET' ? { read: { start: decision.start, end: decision.end } } : {})
    }
  }

  return {
    status: 200,
    headers: { ...base, 'Content-Length': String(input.size) },
    ...(method === 'GET' && input.size > 0 ? { read: { start: 0, end: input.size - 1 } } : {})
  }
}
