// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// ACE-specific comparison recipe knowledge: what the validated Turbo control
// tuple is, which config fields a candidate may vary, and when two requests
// share one LM blueprint. Queue mechanics (batching, caps, pruning) stay
// engine-neutral in generation-queue/comparison.ts and receive these rules
// through the provider interface.

import { isDeepStrictEqual } from 'node:util'
import type { GenerateRequest } from '@iblis/plugin-sdk'

const VARIANT_CONFIG_KEYS = new Set(['synthModel', 'steps', 'guidance', 'shift', 'solver'])

function blueprintInput(request: GenerateRequest): unknown {
  const config = Object.fromEntries(
    Object.entries(request.config ?? {}).filter(([key]) => !VARIANT_CONFIG_KEYS.has(key))
  )
  return {
    prompt: request.prompt,
    durationSec: request.durationSec,
    ...(request.lyrics === undefined ? {} : { lyrics: request.lyrics }),
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    config
  }
}

function synthesisVariant(request: GenerateRequest): unknown {
  return {
    synthModel: request.config?.synthModel,
    steps: request.config?.steps,
    guidance: request.config?.guidance,
    shift: request.config?.shift,
    solver: request.config?.solver
  }
}

export function sameComparisonBlueprint(
  control: GenerateRequest,
  candidate: GenerateRequest
): boolean {
  return isDeepStrictEqual(blueprintInput(control), blueprintInput(candidate))
}

export function isComparisonControl(request: GenerateRequest): boolean {
  return request.preset === 'turbo-validated'
}

export function comparisonRecipeError(
  control: GenerateRequest,
  candidate: GenerateRequest
): string | null {
  if (
    !isComparisonControl(control) ||
    control.config?.steps !== 8 ||
    control.config.guidance !== 1 ||
    control.config.shift !== 3 ||
    control.config.solver !== 'euler'
  ) {
    return 'comparison control is not the validated Turbo recipe'
  }
  if (isComparisonControl(candidate)) return 'comparison candidate matches the control'
  if (isDeepStrictEqual(synthesisVariant(control), synthesisVariant(candidate))) {
    return 'comparison candidate matches the control'
  }
  if (!sameComparisonBlueprint(control, candidate)) {
    return 'comparison candidates do not share one LM blueprint'
  }
  return null
}
