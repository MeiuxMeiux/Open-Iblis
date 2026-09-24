// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ProcessorJobView,
  ProcessorResultRecord,
  ProcessorSettings
} from '../shared/processors'
import { detectedValue, jobStatus, providerState } from '../src/lib/processors/presentation'

const root = resolve(__dirname, '..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

const noProviders: ProcessorSettings = { defaults: {}, providers: [], acknowledgements: {} }

describe('processor renderer and IPC surface', () => {
  it('presents no-detector and unavailable-default states honestly', () => {
    expect(providerState(noProviders, 'bpm-detect')).toBe(
      'No approved BPM detector is installed. Detection is off.'
    )
    expect(
      providerState(
        { ...noProviders, defaults: { 'key-detect': 'missing.provider' } },
        'key-detect'
      )
    ).toContain('selected provider (missing.provider) is unavailable')
  })

  it('presents detected values separately from queue, running, and failed work', () => {
    const result: ProcessorResultRecord = {
      trackId: 'track-1',
      pluginId: 'mx.iblis.detector',
      pluginVersion: '1.0.0',
      resultSchema: 1,
      sourceSha256: 'a'.repeat(64),
      configHash: 'b'.repeat(64),
      computedAt: 1,
      computeMs: 2,
      capability: 'bpm-detect',
      value: { schemaVersion: 1, bpm: 128, confidence: null, alternatives: [] }
    }
    const job: ProcessorJobView = {
      id: 'job-1',
      trackId: 'track-1',
      capabilities: ['bpm-detect'],
      pluginId: result.pluginId,
      pluginVersion: result.pluginVersion,
      status: 'running',
      attempts: 1,
      progress: 0.42,
      createdAt: 1,
      updatedAt: 2
    }
    expect(detectedValue(result)).toBe('128.0 BPM')
    expect(jobStatus(job)).toBe('Running (42%)')
    expect(jobStatus({ ...job, status: 'queued' })).toBe('Queued')
    expect(jobStatus({ ...job, status: 'error' })).toBe('Failed')
  })

  it('keeps provider selection and retry behind the typed contextBridge', () => {
    const preload = read('electron/preload/index.ts')
    const ipc = read('electron/main/ipc-processors.ts')
    const settings = read('src/lib/views/ProcessorSettingsPanel.svelte')
    const detail = read('src/lib/library/ProcessorDetailSections.svelte')
    const drawer = read('src/lib/library/TrackDetailDrawer.svelte')

    for (const channel of [
      'processors:settings',
      'processors:detail',
      'processors:acknowledge',
      'processors:set-default',
      'processors:benchmarks',
      'processors:benchmark',
      'processors:export-benchmark',
      'processors:retry'
    ]) {
      expect(preload).toContain(channel)
      expect(ipc).toContain(channel)
    }
    expect(read('shared/processors.ts')).toContain('providers: ProcessorProviderView[]')
    expect(read('shared/processors.ts')).toContain('ProcessorProviderDetail')
    expect(preload).not.toContain('lab-catalog')
    expect(settings).toContain('No provider selected')
    expect(settings).toContain('Audio analysis')
    expect(read('src/lib/processors/ProcessorBenchmarkPanel.svelte')).toContain(
      'does not change defaults'
    )
    expect(read('src/lib/processors/ProcessorBenchmarkPanel.svelte')).not.toContain('<select')
    expect(read('src/lib/processors/ProcessorBenchmarkPanel.svelte')).toContain('finally')
    expect(read('src/lib/processors/ProcessorTrackPicker.svelte')).toContain('role="listbox"')
    expect(read('src/lib/processors/ProcessorTrackPicker.svelte')).toContain(
      'var(--color-bg-elevated)'
    )
    expect(read('src/lib/processors/ProcessorBenchmarkResults.svelte')).toContain('Peak memory')
    expect(read('src/lib/processors/ProcessorProviderDialog.svelte')).toContain(
      'Enable for private evaluation'
    )
    expect(detail).toContain('Detection status')
    expect(detail).toContain('Detected audio evidence')
    expect(drawer).toContain('Generation targets and resolved plan')
    expect(detail).toContain('Retry ${capabilityName(capability)}')
  })

  it('contains processor startup failure after the queue and Training are initialized', () => {
    const startup = read('electron/main/index.ts')
    expect(startup).toContain('.then(() => initializeTraining())')
    expect(startup).toContain(
      'initializeProcessors({ input: getProcessorInput, mayRun: processorsMayRun })'
    )
    expect(startup).toContain("log('error', 'processor host initialization failed'")
  })
})
