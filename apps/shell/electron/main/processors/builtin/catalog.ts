// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Built-in BPM/key detectors that ship inside the shell and run in a worker
// thread (no installer lifecycle, no sidecar, no network). They exist so alpha
// testers can compare detector opinions today; every entry still carries the
// full evaluation disclosure the plugin path requires, and restricted licenses
// (GPL/AGPL) demand the same explicit acknowledgement before selection. The
// promotion rules in docs/feature/processor-lab.md apply unchanged: an
// evaluation-only entry must be relicensed, replaced, or removed before any
// commercial release.

import type { ProcessorAnalysisCapability, ProcessorEvaluationV1 } from '@iblis/plugin-sdk'
import { OFFICIAL_SITE_ORIGIN } from '../../official-endpoints'

export interface BuiltinProcessorDefinition {
  id: string
  name: string
  version: string
  capabilities: ProcessorAnalysisCapability[]
  author: string
  authorUrl?: string
  codeLicense: string
  evaluation: ProcessorEvaluationV1
}

export const BUILTIN_PROCESSORS: readonly BuiltinProcessorDefinition[] = [
  {
    id: 'mx.iblis.builtin.dsp',
    name: 'Iblis DSP',
    version: '1.0.0',
    capabilities: ['bpm-detect', 'key-detect'],
    author: 'Meiux Meiux LLC',
    codeLicense: 'First-party',
    evaluation: {
      status: 'commercial-candidate',
      distribution: 'public-catalog',
      codeLicense: 'First-party (Meiux Meiux LLC)',
      dependencyLicenses: [],
      termsUrl: OFFICIAL_SITE_ORIGIN,
      noticePath: 'built-in',
      upstreamRevision: 'iblis-dsp@1.0.0',
      acknowledgement:
        'First-party spectral-flux tempo and Krumhansl-Schmuckler key estimation. No third-party terms apply.'
    }
  },
  {
    id: 'mx.iblis.builtin.musictempo',
    name: 'MusicTempo',
    version: '1.0.3',
    capabilities: ['bpm-detect'],
    author: 'killercrush (music-tempo)',
    authorUrl: 'https://github.com/killercrush/music-tempo',
    codeLicense: 'MIT',
    evaluation: {
      status: 'commercial-candidate',
      distribution: 'public-catalog',
      codeLicense: 'MIT',
      dependencyLicenses: ['music-tempo@1.0.3 (MIT)'],
      termsUrl: 'https://github.com/killercrush/music-tempo/blob/master/LICENCE.txt',
      noticePath: 'built-in',
      upstreamRevision: 'music-tempo@1.0.3',
      acknowledgement:
        'MIT-licensed onset-clustering tempo estimator (Dixon 2001 family), bundled with Iblis.'
    }
  },
  {
    id: 'mx.iblis.builtin.essentia',
    name: 'Essentia (WASM)',
    version: '0.1.3',
    capabilities: ['bpm-detect', 'key-detect'],
    author: 'Music Technology Group, Universitat Pompeu Fabra',
    authorUrl: 'https://essentia.upf.edu',
    codeLicense: 'AGPL-3.0-only',
    evaluation: {
      status: 'evaluation-only',
      distribution: 'public-catalog',
      codeLicense: 'AGPL-3.0-only',
      dependencyLicenses: ['essentia.js@0.1.3 (AGPL-3.0)'],
      termsUrl: 'https://essentia.upf.edu/licensing_information.html',
      noticePath: 'built-in',
      upstreamRevision: 'essentia.js@0.1.3',
      acknowledgement:
        'Essentia is AGPL-3.0. It ships in this alpha strictly for detector evaluation and comparison. Selecting it records your acknowledgement that results are for evaluation.',
      releaseBlocker:
        'AGPL-3.0: remove, relicense, or open-source the application before any commercial release.'
    }
  },
  {
    id: 'mx.iblis.builtin.aubio',
    name: 'aubio (WASM)',
    version: '0.2.1',
    capabilities: ['bpm-detect'],
    author: 'Paul Brossier (aubio)',
    authorUrl: 'https://aubio.org',
    codeLicense: 'GPL-3.0-or-later',
    evaluation: {
      status: 'evaluation-only',
      distribution: 'public-catalog',
      codeLicense: 'GPL-3.0-or-later',
      dependencyLicenses: ['aubiojs@0.2.1 (GPL-3.0)', 'aubio@0.4.9 (GPL-3.0)'],
      termsUrl: 'https://aubio.org/license',
      noticePath: 'built-in',
      upstreamRevision: 'aubiojs@0.2.1',
      acknowledgement:
        'aubio is GPL-3.0. It ships in this alpha strictly for detector evaluation and comparison. Selecting it records your acknowledgement that results are for evaluation.',
      releaseBlocker:
        'GPL-3.0: remove, relicense, or open-source the application before any commercial release.'
    }
  }
]

export function isBuiltinProcessor(id: string): boolean {
  return BUILTIN_PROCESSORS.some((definition) => definition.id === id)
}

export function builtinProcessor(id: string): BuiltinProcessorDefinition | null {
  return BUILTIN_PROCESSORS.find((definition) => definition.id === id) ?? null
}
