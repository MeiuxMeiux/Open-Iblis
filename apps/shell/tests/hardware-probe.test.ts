// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  parseSystemProfilerDisplays,
  parseVulkanSummary,
  probeHardware,
  summarizeHardware,
  unifiedGpuBudgetMb,
  vulkaninfoCommand,
  type Runner
} from '../electron/main/hardware/probe'
import { nvidiaSmiCommand } from '../electron/main/hardware'

// Shapes from real tools: system_profiler on an M2 Pro and on an Intel Mac
// with a Radeon, vulkaninfo --summary on an RTX laptop with an iGPU and
// llvmpipe.
const M2_PRO = JSON.stringify({
  SPDisplaysDataType: [
    {
      _name: 'Apple M2 Pro',
      sppci_model: 'Apple M2 Pro',
      sppci_cores: '19',
      spdisplays_mtlgpufamilysupport: 'spdisplays_metal3',
      sppci_device_type: 'spdisplays_gpu'
    }
  ]
})
const INTEL_MAC = JSON.stringify({
  SPDisplaysDataType: [
    { sppci_model: 'Intel UHD Graphics 630', spdisplays_vram_shared: '1536 MB' },
    { sppci_model: 'AMD Radeon Pro 5500M', spdisplays_vram: '8 GB' }
  ]
})
const VULKAN = `==========
VULKANINFO
==========
Devices:
========
GPU0:
	apiVersion         = 1.4.312
	deviceType         = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU
	deviceName         = NVIDIA GeForce RTX 5070 Laptop GPU
GPU1:
	deviceType         = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU
	deviceName         = Intel(R) Graphics
GPU2:
	deviceType         = PHYSICAL_DEVICE_TYPE_CPU
	deviceName         = llvmpipe (LLVM 19.1.1, 256 bits)
`

function fakeRunner(answers: Record<string, string | null>): Runner {
  return async (file, args) => answers[[file, ...args].join(' ')] ?? null
}

describe('macOS probe', () => {
  it('reads the Apple GPU as unified memory with a Metal budget', () => {
    const [gpu] = parseSystemProfilerDisplays(M2_PRO, 16384)
    expect(gpu).toEqual({
      name: 'Apple M2 Pro',
      vendor: 'apple',
      memoryMb: unifiedGpuBudgetMb(16384),
      unifiedMemory: true,
      apis: ['metal'],
      cores: 19
    })
    expect(unifiedGpuBudgetMb(16384)).toBe(10922)
    expect(unifiedGpuBudgetMb(64 * 1024)).toBe(48 * 1024)
  })

  it('reads an Intel Mac with a discrete Radeon', () => {
    const gpus = parseSystemProfilerDisplays(INTEL_MAC, 32768)
    expect(gpus.map((g) => [g.vendor, g.memoryMb, g.unifiedMemory])).toEqual([
      ['intel', 1536, false],
      ['amd', 8192, false]
    ])
  })

  it('survives garbage', () => {
    expect(parseSystemProfilerDisplays('not json', 1)).toEqual([])
    expect(parseSystemProfilerDisplays('{"SPDisplaysDataType": 5}', 1)).toEqual([])
  })

  it('asks sysctl one key at a time, so a missing Intel-only key loses nothing', async () => {
    const calls: string[] = []
    const answers: Record<string, string | null> = {
      '/usr/sbin/sysctl -n machdep.cpu.brand_string': 'Apple M2 Pro\n',
      // Apple Silicon running a native build: the key exists and says 0.
      '/usr/sbin/sysctl -n sysctl.proc_translated': '0\n',
      '/usr/sbin/sysctl -n hw.memsize': String(16 * 1024 ** 3),
      '/usr/sbin/system_profiler SPDisplaysDataType -json': M2_PRO
    }
    const runner: Runner = async (file, args) => {
      calls.push([file, ...args].join(' '))
      return fakeRunner(answers)(file, args)
    }
    const report = await probeHardware(runner, 'darwin')
    expect(calls.every((c) => !c.startsWith('/usr/sbin/sysctl') || c.split(' ').length === 3)).toBe(
      true
    )
    expect(report.cpu).toBe('Apple M2 Pro')
    expect(report.memoryMb).toBe(16384)
    expect(report.gpus[0]?.name).toBe('Apple M2 Pro')
    expect(summarizeHardware(report)).toBe(
      'Apple M2 Pro (19-core GPU), 16 GB unified memory, ~10.7 GB for models'
    )
  })

  it('flags the Intel build running under Rosetta 2', async () => {
    const runner = fakeRunner({ '/usr/sbin/sysctl -n sysctl.proc_translated': '1' })
    const report = await probeHardware(runner, 'darwin')
    expect(report.rosetta).toBe(true)
    expect(summarizeHardware(report)).toBe('running the Intel build under Rosetta 2')
  })

  it('never looks for nvidia-smi on a Mac', () => {
    expect(nvidiaSmiCommand('darwin', {}, () => true)).toBeNull()
  })
})

describe('Vulkan probe', () => {
  it('lists real GPUs and drops CPU rasterizers', () => {
    expect(parseVulkanSummary(VULKAN)).toEqual([
      { name: 'NVIDIA GeForce RTX 5070 Laptop GPU', type: 'PHYSICAL_DEVICE_TYPE_DISCRETE_GPU' },
      { name: 'Intel(R) Graphics', type: 'PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU' }
    ])
  })

  it('uses absolute vulkaninfo paths only', () => {
    expect(vulkaninfoCommand('win32', { SystemRoot: 'C:\\Windows' }, () => true)).toBe(
      join('C:\\Windows', 'System32', 'vulkaninfo.exe')
    )
    expect(vulkaninfoCommand('linux', {}, (p) => p === '/usr/bin/vulkaninfo')).toBe(
      '/usr/bin/vulkaninfo'
    )
    expect(vulkaninfoCommand('darwin', {}, () => true)).toBeNull()
  })
})
