// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { parseNvidiaSmiMemory } from '../electron/main/hardware'
import { evaluateTrainingPreflight } from '../electron/main/hardware/preflight'
import type { PreflightFacts } from '../electron/main/hardware/preflight'

const READY: PreflightFacts = {
  vramTotalMb: 16384,
  freeDiskBytes: 200 * 1024 ** 3,
  queueBusy: false,
  packInstalled: true
}

function row(facts: Partial<PreflightFacts>, id: string) {
  const report = evaluateTrainingPreflight({ ...READY, ...facts }, 1234)
  const found = report.rows.find((r) => r.id === id)
  if (!found) throw new Error(`missing row ${id}`)
  return { report, row: found }
}

describe('parseNvidiaSmiMemory', () => {
  it('reads total and used from csv output', () => {
    expect(parseNvidiaSmiMemory('8192, 512\n')).toEqual({ totalMb: 8192, usedMb: 512 })
  })

  it('takes the most capable card on multi-GPU boxes', () => {
    expect(parseNvidiaSmiMemory('4096, 100\n16384, 9000\n')).toEqual({
      totalMb: 16384,
      usedMb: 9000
    })
  })

  it('returns nulls for garbage or empty output', () => {
    expect(parseNvidiaSmiMemory('')).toEqual({ totalMb: null, usedMb: null })
    expect(parseNvidiaSmiMemory('N/A, N/A')).toEqual({ totalMb: null, usedMb: null })
  })
})

describe('evaluateTrainingPreflight', () => {
  it('passes a comfortable machine', () => {
    const report = evaluateTrainingPreflight(READY, 99)
    expect(report.ok).toBe(true)
    expect(report.generatedAt).toBe(99)
    expect(report.rows.map((r) => r.status)).toEqual(['pass', 'pass', 'pass', 'pass'])
  })

  it('fails below the 6 GB VRAM floor (D4 revised)', () => {
    const { report, row: gpu } = row({ vramTotalMb: 4096 }, 'gpu')
    expect(gpu.status).toBe('fail')
    expect(gpu.detail).toContain('too little')
    expect(report.ok).toBe(false)
  })

  it('warns (not fails) for an 8 GB card, including one reporting just under 8192 (D4 revised)', () => {
    for (const vramTotalMb of [8192, 8000, 7168]) {
      const { report, row: gpu } = row({ vramTotalMb }, 'gpu')
      expect(gpu.status).toBe('warn')
      expect(gpu.detail).toContain('supported')
      expect(report.ok).toBe(true)
    }
  })

  it('warns with honest copy in the sub-16 GB band', () => {
    const { report, row: gpu } = row({ vramTotalMb: 8192 }, 'gpu')
    expect(gpu.status).toBe('warn')
    expect(gpu.detail).toContain('tight')
    expect(gpu.detail).toContain('uncalibrated')
    expect(report.ok).toBe(true)
  })

  it('fails honestly when the GPU probe returns nothing', () => {
    const { report, row: gpu } = row({ vramTotalMb: null }, 'gpu')
    expect(gpu.status).toBe('fail')
    expect(gpu.detail).toContain('nvidia-smi')
    expect(report.ok).toBe(false)
  })

  it('fails when scratch space is short and states both numbers', () => {
    const { row: disk } = row({ freeDiskBytes: 2 * 1024 ** 3 }, 'disk')
    expect(disk.status).toBe('fail')
    expect(disk.detail).toMatch(/needs about .* is free/)
  })

  it('warns rather than blocks when the disk probe fails', () => {
    const { report, row: disk } = row({ freeDiskBytes: null }, 'disk')
    expect(disk.status).toBe('warn')
    expect(report.ok).toBe(true)
  })

  it('scales the scratch estimate with the scanned track count', () => {
    const small = evaluateTrainingPreflight({ ...READY, trackCount: 10 }, 1)
    const large = evaluateTrainingPreflight(
      { ...READY, trackCount: 40, freeDiskBytes: 20 * 1024 ** 3 },
      1
    )
    expect(small.rows.find((r) => r.id === 'disk')?.status).toBe('pass')
    expect(large.rows.find((r) => r.id === 'disk')?.status).toBe('fail')
  })

  it('fails on a busy queue with copy that promises no cancellation', () => {
    const { row: queue } = row({ queueBusy: true }, 'queue')
    expect(queue.status).toBe('fail')
    expect(queue.detail).toContain('never cancels')
  })

  it('fails without the training pack', () => {
    const { row: pack } = row({ packInstalled: false }, 'pack')
    expect(pack.status).toBe('fail')
  })
})
