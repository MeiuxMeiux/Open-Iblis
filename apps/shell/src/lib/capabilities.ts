// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Renderer-side capability helpers for Create. The engine's capabilities are
// signed facts from main; these functions decide what the form shows and
// what a draft may carry, never inventing a control the engine did not
// declare. Admission in main re-checks everything.

import type { EngineAdvancedControlV2 } from '@iblis/plugin-sdk'
import type { AdvancedValues, EngineCapabilities } from '../../shared/engine-info'

// Values a control accepts, without throwing: invalid or undeclared entries
// fall back to the descriptor default so the drawer always shows a valid
// state after an engine switch.
export function reconcileAdvanced(
  values: AdvancedValues,
  capabilities: EngineCapabilities | null
): AdvancedValues {
  const next: AdvancedValues = {}
  for (const control of capabilities?.advancedControls ?? []) {
    const value = values[control.id]
    next[control.id] = value !== undefined && acceptsValue(control, value) ? value : control.default
  }
  return next
}

function acceptsValue(control: EngineAdvancedControlV2, value: boolean | number | string): boolean {
  switch (control.kind) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'enum':
      return typeof value === 'string' && control.values.includes(value)
    case 'integer':
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= control.min &&
        value <= control.max &&
        (control.kind === 'number' || Number.isInteger(value))
      )
  }
}

// Only entries that differ from the descriptor default travel with the
// request; the engine applies its own defaults for the rest.
export function changedAdvanced(
  values: AdvancedValues,
  capabilities: EngineCapabilities | null
): AdvancedValues | undefined {
  const changed: AdvancedValues = {}
  for (const control of capabilities?.advancedControls ?? []) {
    const value = values[control.id]
    if (value !== undefined && value !== control.default && acceptsValue(control, value)) {
      changed[control.id] = value
    }
  }
  return Object.keys(changed).length > 0 ? changed : undefined
}

// Whether one config key survives trimming for this engine: ACE `advanced`
// tuning only for non-native engines, other keys only when declared (native
// engines keep them all), and style/lyrics keys only when supported.
function keepConfigKey(key: string, capabilities: EngineCapabilities): boolean {
  if (key === 'advanced') return !capabilities.nativeTuning
  if (!capabilities.nativeTuning && !capabilities.commonControls.includes(key as never)) {
    return false
  }
  if (key === 'adapter' || key === 'adapterScale') return capabilities.styles
  if (key === 'autoLyrics') return capabilities.autoLyrics
  return true
}

// Trim a built config to what the engine declares so a v1 engine never sees
// v2 keys and a v2 engine never sees ACE tuning it would refuse.
export function fitConfig<T extends Record<string, unknown>>(
  config: T | undefined,
  capabilities: EngineCapabilities | null
): T | undefined {
  if (!config || !capabilities) return config
  const next = Object.fromEntries(
    Object.entries(config).filter(([key]) => keepConfigKey(key, capabilities))
  )
  return Object.keys(next).length > 0 ? (next as T) : undefined
}
