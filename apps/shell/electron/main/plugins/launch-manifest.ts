// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Launch-time manifest preparation, split out of lifecycle.ts so engine
// drivers can start a sidecar on demand without importing the queue-facing
// lifecycle module (which imports the generation queue — a cycle otherwise).

import type { PluginManifest } from '@iblis/plugin-sdk'
import { listAdapters } from '../adapters'
import { syncGenerationAdapterRoot, withGenerationAdapterRoot } from '../adapters/generation-root'
import { assertHostCompatible } from './host-compatibility'

// Every v1 engine launch mirrors the adapter library into the generation root
// and appends --adapters, so the live registry always matches the library.
// Contract-v2 engines get adapters only through an explicitly declared
// ingress; absent (or not yet host-supported) means the manifest launches
// untouched — no adapter root, no CLI flag. Non-engine manifests pass through
// untouched; a sync failure launches the engine style-less rather than not
// at all.
export async function engineLaunchManifest(manifest: PluginManifest): Promise<PluginManifest> {
  assertHostCompatible(manifest)
  if (manifest.kind !== 'engine') return manifest
  // The iblis-root-v1 ingress (adapter root via a documented env var) lands
  // with the first pack that declares it; until then a v2 manifest is never
  // given the v1 --adapters treatment.
  if (manifest.engine) return manifest
  try {
    await syncGenerationAdapterRoot(await listAdapters())
    return withGenerationAdapterRoot(manifest)
  } catch {
    return manifest
  }
}
