// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Filesystem adapter for the pure range planner. Opens the selected track once,
// stats that handle, and streams only the inclusive interval in the plan. No
// full-file renderer copy and no renderer-supplied path.

import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { planMediaResponse } from './range'
import { ignoreFailure } from '../ignore-failure'

const NOT_FOUND_HEADERS = { 'Content-Length': '0' }

export function mediaMime(format: string): string {
  if (format.toLowerCase() === 'wav') return 'audio/wav'
  if (format.toLowerCase() === 'mp3') return 'audio/mpeg'
  if (format.toLowerCase() === 'flac') return 'audio/flac'
  return 'application/octet-stream'
}

export async function respondWithLocalFile(
  request: Request,
  filePath: string,
  mime = 'audio/wav'
): Promise<Response> {
  let handle
  try {
    handle = await open(filePath, 'r')
    const info = await handle.stat()
    if (!info.isFile()) {
      await handle.close()
      return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
    }

    const plan = planMediaResponse({
      method: request.method,
      range: request.headers.get('range'),
      size: info.size,
      mime
    })
    if (!plan.read) {
      await handle.close()
      return new Response(null, { status: plan.status, headers: plan.headers })
    }

    const stream = handle.createReadStream({
      start: plan.read.start,
      end: plan.read.end,
      highWaterMark: 64 * 1024,
      autoClose: true,
      signal: request.signal
    })
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>
    return new Response(body, { status: plan.status, headers: plan.headers })
  } catch (error) {
    await handle?.close().catch(ignoreFailure)
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
    }
    throw error
  }
}
