// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Platform-aware hardware facts: what GPU this computer has and how much memory
// it can give a model, without assuming NVIDIA. Every probe is best-effort and
// bounded; a missing tool or odd output yields fewer facts, never a throw.
//
//   Windows/Linux  nvidia-smi (CUDA cards) + vulkaninfo --summary when present
//   macOS          sysctl, one key per call, + system_profiler for the GPU
//
// One key per sysctl call is deliberate: Apple Silicon has no
// machdep.cpu.leaf7_features and similar Intel-only keys, and sysctl exits 1
// when ANY requested key is missing, so a combined query loses every answer
// (the Samsara Mac probe bug, 2026-11-03).

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { totalmem, cpus } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { nvidiaSmiCommand, parseNvidiaSmiMemory } from './index'

const run = promisify(execFile)
const TIMEOUT_MS = 5000

type GpuApi = 'cuda' | 'metal' | 'vulkan'

export interface GpuDevice {
  name: string
  vendor: 'nvidia' | 'apple' | 'amd' | 'intel' | 'other'
  // Memory a model can use. Unified-memory Macs report an estimate of Metal's
  // working-set limit, not the whole RAM (see unifiedGpuBudgetMb).
  memoryMb: number | null
  unifiedMemory: boolean
  apis: GpuApi[]
  cores?: number
}

export interface HardwareReport {
  os: string
  arch: string
  cpu: string | null
  memoryMb: number
  // An x64 build running on Apple Silicon through Rosetta 2.
  rosetta: boolean
  gpus: GpuDevice[]
}

export type Runner = (file: string, args: string[]) => Promise<string | null>

const defaultRunner: Runner = async (file, args) => {
  try {
    const out = await run(file, args, {
      windowsHide: true,
      timeout: TIMEOUT_MS,
      maxBuffer: 1 << 20
    })
    return out.stdout
  } catch {
    return null
  }
}

// Metal's recommendedMaxWorkingSetSize is about two thirds of RAM on smaller
// Macs and three quarters on larger ones (observed: 16 GB -> ~10.7 GB, 64 GB
// -> ~48 GB). An estimate for picking presets, labelled as such in the UI.
export function unifiedGpuBudgetMb(memoryMb: number): number {
  const share = memoryMb > 36 * 1024 ? 0.75 : 2 / 3
  return Math.floor(memoryMb * share)
}

function vendorOf(name: string): GpuDevice['vendor'] {
  const n = name.toLowerCase()
  if (n.includes('nvidia') || n.includes('geforce') || n.includes('rtx')) return 'nvidia'
  if (n.startsWith('apple')) return 'apple'
  if (n.includes('amd') || n.includes('radeon')) return 'amd'
  if (n.includes('intel')) return 'intel'
  return 'other'
}

function parseVramText(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const m = /([\d.]+)\s*(GB|MB)/i.exec(text)
  if (!m?.[1] || !m[2]) return null
  const value = Number.parseFloat(m[1])
  return Math.round(m[2].toUpperCase() === 'GB' ? value * 1024 : value)
}

// `system_profiler SPDisplaysDataType -json`. Apple Silicon lists one Apple
// GPU with sppci_cores and no VRAM (unified); Intel Macs list the iGPU and/or
// a discrete AMD card with spdisplays_vram.
export function parseSystemProfilerDisplays(stdout: string, memoryMb: number): GpuDevice[] {
  let doc: unknown
  try {
    doc = JSON.parse(stdout)
  } catch {
    return []
  }
  const items = (doc as { SPDisplaysDataType?: unknown }).SPDisplaysDataType
  if (!Array.isArray(items)) return []
  const gpus: GpuDevice[] = []
  for (const item of items as Record<string, unknown>[]) {
    const name = typeof item.sppci_model === 'string' ? item.sppci_model : null
    if (!name) continue
    const vendor = vendorOf(name)
    const unified = vendor === 'apple'
    const vram = parseVramText(item.spdisplays_vram ?? item.spdisplays_vram_shared)
    const cores =
      typeof item.sppci_cores === 'string' ? Number.parseInt(item.sppci_cores, 10) : Number.NaN
    gpus.push({
      name,
      vendor,
      memoryMb: unified ? unifiedGpuBudgetMb(memoryMb) : vram,
      unifiedMemory: unified,
      apis: ['metal'],
      ...(Number.isFinite(cores) && cores > 0 ? { cores } : {})
    })
  }
  return gpus
}

// `vulkaninfo --summary`: one "deviceName = ..." per physical device, with a
// deviceType line. CPU (llvmpipe/SwiftShader) devices are dropped.
export function parseVulkanSummary(stdout: string): { name: string; type: string }[] {
  const devices: { name: string; type: string }[] = []
  let type = ''
  for (const line of stdout.split(/\r?\n/)) {
    const t = /deviceType\s*=\s*(\S+)/.exec(line)
    if (t?.[1]) type = t[1]
    const n = /deviceName\s*=\s*(.+)$/.exec(line)
    if (n?.[1]) {
      devices.push({ name: n[1].trim(), type })
      type = ''
    }
  }
  return devices.filter((d) => !d.type.includes('CPU'))
}

export function vulkaninfoCommand(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  // Absolute paths only, for the same planted-binary reason as nvidia-smi.
  const candidates =
    platform === 'win32'
      ? [join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'vulkaninfo.exe')]
      : platform === 'linux'
        ? ['/usr/bin/vulkaninfo', '/usr/local/bin/vulkaninfo']
        : []
  return candidates.find((path) => exists(path)) ?? null
}

async function sysctl(runner: Runner, key: string): Promise<string | null> {
  const out = await runner('/usr/sbin/sysctl', ['-n', key])
  const value = out?.trim() ?? ''
  return value === '' ? null : value
}

async function probeMac(runner: Runner, memoryMb: number): Promise<Partial<HardwareReport>> {
  // sysctl.proc_translated is 1 for a process Rosetta 2 translates, 0 for a
  // native one, and missing on Intel Macs (sysctl exits 1, so it reads null).
  const [brand, translated, memsize, displays] = await Promise.all([
    sysctl(runner, 'machdep.cpu.brand_string'),
    sysctl(runner, 'sysctl.proc_translated'),
    sysctl(runner, 'hw.memsize'),
    runner('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'])
  ])
  const bytes = Number(memsize)
  const mem = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1024 ** 2) : memoryMb
  return {
    cpu: brand,
    memoryMb: mem,
    rosetta: translated === '1',
    gpus: displays ? parseSystemProfilerDisplays(displays, mem) : []
  }
}

async function probeNvidia(runner: Runner): Promise<GpuDevice[]> {
  const smi = nvidiaSmiCommand()
  if (smi === null) return []
  const out = await runner(smi, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
  if (!out) return []
  return out
    .split(/\r?\n/)
    .map((line) => line.split(',').map((f) => f.trim()))
    .filter(([name]) => Boolean(name))
    .map(([name = '', total = '']) => ({
      name,
      vendor: 'nvidia' as const,
      memoryMb: parseNvidiaSmiMemory(`${total},0`).totalMb,
      unifiedMemory: false,
      apis: ['cuda' as const]
    }))
}

async function probeVulkan(runner: Runner, known: GpuDevice[]): Promise<GpuDevice[]> {
  const command = vulkaninfoCommand()
  if (command === null) return known
  const out = await runner(command, ['--summary'])
  if (!out) return known
  const merged = [...known]
  for (const device of parseVulkanSummary(out)) {
    const same = merged.find((g) => g.name === device.name)
    if (same) {
      if (!same.apis.includes('vulkan')) same.apis.push('vulkan')
    } else {
      merged.push({
        name: device.name,
        vendor: vendorOf(device.name),
        memoryMb: null,
        unifiedMemory: device.type.includes('INTEGRATED'),
        apis: ['vulkan']
      })
    }
  }
  return merged
}

export async function probeHardware(
  runner: Runner = defaultRunner,
  platform: NodeJS.Platform = process.platform
): Promise<HardwareReport> {
  const memoryMb = Math.round(totalmem() / 1024 ** 2)
  const base: HardwareReport = {
    os: platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? null,
    memoryMb,
    rosetta: false,
    gpus: []
  }
  if (platform === 'darwin') return { ...base, ...(await probeMac(runner, memoryMb)) }
  return { ...base, gpus: await probeVulkan(runner, await probeNvidia(runner)) }
}

// One line for diagnostics and support: "Apple M2 Pro (19-core GPU), 16 GB
// unified memory, ~10.7 GB for models" or the nvidia-smi style for CUDA cards.
export function summarizeHardware(report: HardwareReport): string {
  const gb = (mb: number): string => `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB`
  const parts = report.gpus.map((g) => {
    const cores = g.cores ? ` (${g.cores}-core GPU)` : ''
    if (g.unifiedMemory && report.os === 'darwin')
      return `${g.name}${cores}, ${gb(report.memoryMb)} unified memory, ~${gb(g.memoryMb ?? 0)} for models`
    const mem = g.memoryMb !== null ? `, ${gb(g.memoryMb)}` : ''
    return `${g.name}${mem} [${g.apis.join('+')}]`
  })
  if (report.rosetta) parts.push('running the Intel build under Rosetta 2')
  return parts.join('; ')
}
