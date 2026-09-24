// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Engine operations IPC: the performance panel's handlers (moved from ipc.ts
// to keep it under its size cap) plus the audio-conditioning actions probe.
import { ipcMain } from 'electron'
import type { PerfSettings } from '../../shared/perf'
import { perfInfo, setPerf } from './perf'
import { restartActiveSidecars } from './plugins/lifecycle'
import { requestSidecar } from './sidecar/supervisor'
import { resourceCoordinator } from './resource-state'
import {
  runActionsProbe,
  runActionsProbeWithLease,
  readActionsEvidence
} from './engine/drivers/ace-compat/actions-probe'
import { engineProvider } from './engine'
import { listInstalled } from './plugins/registry'
import { guard, guardAsync } from './ipc-guard'

function refuseWhileLocked(): void {
  const refusal = resourceCoordinator().generationRefusal()
  if (refusal) throw new Error(refusal)
}

export function registerEngineOpsIpc(): void {
  ipcMain.handle('perf:info', () => guard(perfInfo))
  ipcMain.handle('perf:set', (_e, settings: PerfSettings) => guard(() => setPerf(settings)))
  ipcMain.handle('perf:restartEngine', () =>
    guardAsync(async () => {
      refuseWhileLocked()
      await restartActiveSidecars()
      return null
    })
  )

  ipcMain.handle('engine:actions-probe', () =>
    guardAsync(() =>
      runActionsProbeWithLease({
        beginMutation: () => resourceCoordinator().beginEngineMutation(),
        engineId: () => engineProvider().activeEngineId(),
        engineVersion: (id) =>
          listInstalled().find((plugin) => plugin.id === id)?.activeVersion ?? null,
        run: (engineId, engineVersion) =>
          runActionsProbe({
            fetch: (path, init) => requestSidecar(engineId, path, init),
            engineId,
            engineVersion
          })
      })
    )
  )
  ipcMain.handle('engine:actions-evidence', () => guardAsync(readActionsEvidence))
}
