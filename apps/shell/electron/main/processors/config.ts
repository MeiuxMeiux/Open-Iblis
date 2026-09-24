// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from 'node:crypto'
import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'

export type ProcessorConfig = Partial<Record<ProcessorAnalysisCapability, Record<string, unknown>>>

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

export function processorConfigHash(config: ProcessorConfig): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex')
}
