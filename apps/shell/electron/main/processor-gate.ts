// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Idle gate for background processor analysis: detectors only run while the
// generation queue is empty and no training holds the GPU.

import { queueSnapshot } from './generation-queue'
import { resourceCoordinator } from './resource-state'

export async function processorsMayRun(): Promise<boolean> {
  if (resourceCoordinator().trainingActive()) return false
  const snapshot = await queueSnapshot()
  return !snapshot.activeId && snapshot.entries.every((entry) => entry.status !== 'pending')
}
