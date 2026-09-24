// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared hardware probes: GPU memory via nvidia-smi and free disk space.
// Used by both the adapter compatibility proof (VRAM delta evidence) and the
// Training preflight (D4 floor). Probes are best-effort — a missing tool or
// odd output yields null, never a throw; callers surface honest copy instead.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SMI_TIMEOUT_MS = 5000

// Absolute nvidia-smi on Windows. A bare name is resolved by libuv against the
// current directory before PATH, so a nvidia-smi.exe planted wherever the app
// was started from would run instead (audit 2026-09-24, L-SHL11). Current
// drivers install to System32; older ones to Program Files\NVIDIA Corporation.
export function nvidiaSmiCommand(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  if (platform !== 'win32') return 'nvidia-smi'
  const candidates = [
    join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    join(env.ProgramFiles ?? 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
  ]
  return candidates.find((path) => exists(path)) ?? null
}

function smiOrThrow(): string {
  const command = nvidiaSmiCommand()
  if (command === null) throw new Error('nvidia-smi not found')
  return command
}

export interface GpuMemory {
  totalMb: number | null
  usedMb: number | null
}

// Parses `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` output:
// one line per GPU, comma-separated numeric fields. Returns the per-column
// maxima so a multi-GPU box reports its most capable card.
export function parseNvidiaSmiMemory(stdout: string): GpuMemory {
  let totalMb: number | null = null
  let usedMb: number | null = null
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.split(',').map((field) => Number.parseInt(field.trim(), 10))
    const [total, used] = fields
    if (total !== undefined && Number.isFinite(total) && total >= 0)
      totalMb = Math.max(totalMb ?? 0, total)
    if (used !== undefined && Number.isFinite(used) && used >= 0)
      usedMb = Math.max(usedMb ?? 0, used)
  }
  return { totalMb, usedMb }
}

export async function gpuMemory(): Promise<GpuMemory> {
  try {
    const result = await execFileAsync(
      smiOrThrow(),
      ['--query-gpu=memory.total,memory.used', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: SMI_TIMEOUT_MS, maxBuffer: 4096 }
    )
    return parseNvidiaSmiMemory(result.stdout)
  } catch {
    return { totalMb: null, usedMb: null }
  }
}

// The compatibility proof records currently-used VRAM (delta evidence).
export async function vramUsedMb(): Promise<number | null> {
  try {
    const result = await execFileAsync(
      smiOrThrow(),
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: SMI_TIMEOUT_MS, maxBuffer: 4096 }
    )
    const values = result.stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((value) => Number.isFinite(value) && value >= 0)
    return values.length ? Math.max(...values) : null
  } catch {
    return null
  }
}

export async function freeDiskBytes(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path)
    const free = stats.bavail * stats.bsize
    return Number.isFinite(free) && free >= 0 ? free : null
  } catch {
    return null
  }
}
