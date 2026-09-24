// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import { randomUUID } from 'node:crypto'
import { listInstalled } from '../plugins/registry'
import { healthAll } from '../sidecar/supervisor'
import { licensingDiagSummary } from '../licensing'
import { redactValue, type DiagLevel } from './redact'
import { nvidiaSmiCommand } from '../hardware'

export const DIAG_SCHEMA = 1

// A stable-but-anonymous id so multiple bundles from one machine correlate
// without identifying it. Random UUID written once to userData; NOT derived
// from hardware.
export function getInstallId(): string {
  const f = join(app.getPath('userData'), 'diag-install-id')
  try {
    if (existsSync(f)) return readFileSync(f, 'utf8').trim()
  } catch {
    /* fall through to mint a new one */
  }
  const id = randomUUID()
  try {
    writeFileSync(f, id)
  } catch {
    /* best effort */
  }
  return id
}

function tail(path: string, lines: number): string {
  try {
    const all = readFileSync(path, 'utf8').split('\n')
    return all.slice(-lines).join('\n')
  } catch {
    return ''
  }
}

// Every log file in userData/logs (main.log + each sidecar-<id>.log), tailed.
// The sidecar logs are where a native engine's launch failure explains itself —
// the whole point of being able to debug the greyed-out Create remotely.
function logs(maxLinesEach: number): Record<string, string> {
  const dir = join(app.getPath('userData'), 'logs')
  const out: Record<string, string> = {}
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.log')) out[name] = tail(join(dir, name), maxLinesEach)
    }
  } catch {
    /* no logs yet */
  }
  return out
}

// Best-effort GPU/driver line via nvidia-smi (the engine is CUDA-only, so this
// is the single most useful system fact). Resolves to '' if unavailable.
function gpuInfo(): Promise<string> {
  const command = nvidiaSmiCommand()
  if (command === null) return Promise.resolve('')
  return new Promise((resolve) => {
    execFile(
      command,
      ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'],
      { timeout: 4000, windowsHide: true },
      (e, stdout) => resolve(e ? '' : stdout.trim())
    )
  })
}

export interface DiagBundle {
  schema: number
  installId: string
  level: DiagLevel
  sentAt: string
  note?: string
  app: Record<string, unknown>
  system: Record<string, unknown>
  plugins: unknown
  health: unknown
  licensing: unknown
  logs: Record<string, string>
}

// Build a redacted diagnostics bundle. `verbose` keeps more log lines + the
// note + user content; `errors` redacts content and tails fewer lines.
export async function buildBundle(level: DiagLevel, note?: string): Promise<DiagBundle> {
  const verbose = level === 'verbose'
  const raw = {
    schema: DIAG_SCHEMA,
    installId: getInstallId(),
    level,
    sentAt: new Date().toISOString(),
    note: note && verbose ? note : undefined,
    app: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch
    },
    system: {
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      ramGB: Math.round(os.totalmem() / 1024 ** 3),
      gpu: await gpuInfo()
    },
    plugins: listInstalled(),
    health: healthAll(),
    // Status/masked-key/expiries + recent licensing events; never key material.
    licensing: licensingDiagSummary(),
    logs: logs(verbose ? 400 : 120)
  }
  return redactValue(raw, level) as DiagBundle
}
