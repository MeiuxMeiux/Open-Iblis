// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ProcessorErrorV1 } from '@iblis/plugin-sdk'

export function processorError(error: unknown, retryable = true): ProcessorErrorV1 {
  const candidate = error as Partial<ProcessorErrorV1> | null | undefined
  if (
    typeof candidate?.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  ) {
    return { code: candidate.code, message: candidate.message, retryable: candidate.retryable }
  }
  return { code: 'host_error', message: 'processor host could not complete analysis', retryable }
}

// A thrown processor error: a real Error (stack, instanceof) that still
// carries the protocol fields processorError() reads back.
export function processorFailure(error: ProcessorErrorV1): Error & ProcessorErrorV1 {
  return Object.assign(new Error(error.message), error)
}
