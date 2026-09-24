// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Create-facing capabilities derived from a signed v2 descriptor: the exact
// set of controls the renderer may show for the operation Create admits.
// Nothing here is guessed; every field is a descriptor fact.

import type { EngineDescriptorV2 } from '@iblis/plugin-sdk'
import type { EngineCapabilities } from '../../../../../shared/contract'
import { operationOf } from './request'

export function v2Capabilities(descriptor: EngineDescriptorV2): EngineCapabilities {
  const operation = operationOf(descriptor)
  return {
    protocol: 2,
    operation: operation.id,
    lyrics: operation.lyrics === null ? 'none' : operation.lyrics.dialect,
    autoLyrics: false,
    styles: operation.adapters !== null && operation.adapters.maxActive > 0,
    seed: operation.seed === 'uint32',
    commonControls: [...operation.commonControls],
    advancedControls: operation.advancedControls.map((control) => ({ ...control })),
    duration: operation.duration
      ? { minSec: operation.duration.minSec, maxSec: operation.duration.maxSec }
      : { minSec: 1, maxSec: 3600 },
    nativeTuning: false,
    outputs: operation.outputs.map((output) => output.role)
  }
}
