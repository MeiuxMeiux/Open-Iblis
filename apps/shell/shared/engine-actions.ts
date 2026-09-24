// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { IpcResult } from './contract'

// Evidence record from the audio-conditioning spike (roadmap-to-beta C.2,
// docs/feature/creation-actions.md slice 1). The probe sends a deterministic
// in-process source WAV through the installed engine's repaint/outpaint task
// and records whether the returned audio actually carries the extension. It
// is a developer/Windows gate: it unlocks follow-up implementation work, not
// any user-facing workflow.
export interface EngineActionsProbeEvidence {
  ranAt: number
  engineId: string
  engineVersion: string | null
  task: 'repaint-extend'
  sourceSec: number
  requestedExtendSec: number
  outputSec: number
  toleranceSec: number
  elapsedMs: number
  passed: boolean
  // True only when the source and returned WAV were persisted for playback.
  // Older evidence records remain readable but correctly report no media.
  mediaAvailable: boolean
  note: string
}

export interface EngineActionsApi {
  engineActions: {
    // Run the repaint/outpaint probe against the running engine. Slow (a full
    // synth pass); resolves with the recorded evidence.
    probe: () => Promise<IpcResult<EngineActionsProbeEvidence>>
    // Most recent recorded evidence, if any probe has ever run here.
    evidence: () => Promise<IpcResult<EngineActionsProbeEvidence | null>>
  }
}
