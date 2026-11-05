// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { TRAINING_PLATFORMS, type TrainingPackState } from '../../../shared/training'
import { hostMatches } from '../plugins/host-compatibility'
import { listInstalled } from '../plugins/registry'

export const TRAINING_PACK_ID = 'mx.iblis.training.acestep'

// Installed state plus whether this host can train at all (Windows x64 with
// CUDA today); the Training view explains instead of offering the pack where
// it cannot run (docs/feature/macos.md).
export function trainingPackState(): TrainingPackState {
  const installed = listInstalled().find((plugin) => plugin.id === TRAINING_PACK_ID)
  return {
    installed: Boolean(installed?.activeVersion),
    version: installed?.activeVersion ?? null,
    // Packaged builds only, like every platform check (host-compatibility.ts):
    // the Linux E2E suite and `just dev` keep the full Training flow.
    platformSupported: !app.isPackaged || hostMatches(TRAINING_PLATFORMS)
  }
}
