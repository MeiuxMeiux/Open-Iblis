// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn, type ChildProcess } from 'node:child_process'
import { join, extname } from 'node:path'
import type { ExecutableSpec } from '@iblis/plugin-sdk'
import { versionDir } from '../plugins/paths'
import { resolveThreadCap } from '../perf'
import { sidecarLog } from '../logger'

// Stub/dev sidecars ship as Node scripts; real engines ship native binaries.
// A `.cjs`/`.js`/`.mjs` bin runs through the bundled Node runtime (Electron in
// ELECTRON_RUN_AS_NODE mode); anything else is executed directly.
const NODE_EXTS = new Set(['.js', '.cjs', '.mjs'])

export interface SpawnConfig {
  id: string
  version: string
  exec: ExecutableSpec
  port: number
  secret: string
}

export function spawnSidecar(cfg: SpawnConfig): ChildProcess {
  const dir = versionDir(cfg.id, cfg.version)
  const binPath = join(dir, cfg.exec.bin)
  const portArg = cfg.exec.portArg ?? '--port'
  const sessionEnv = cfg.exec.sessionEnv ?? 'IBLIS_SESSION'
  const userArgs = cfg.exec.args ?? []

  const env: NodeJS.ProcessEnv = { ...process.env, [sessionEnv]: cfg.secret }
  const isNode = NODE_EXTS.has(extname(cfg.exec.bin))
  if (isNode) env.ELECTRON_RUN_AS_NODE = '1'
  // Native engines: cap the OpenMP pool to the user's performance profile so the
  // heavy CPU phases don't choke every core (see ../perf). Resolved at spawn, so
  // a profile change takes effect on the next engine launch. Don't override an
  // explicit operator-set OMP_NUM_THREADS in the environment.
  if (!isNode && !env.OMP_NUM_THREADS) env.OMP_NUM_THREADS = String(resolveThreadCap())
  // Idle OpenMP workers busy-spin by default (WAIT_POLICY=ACTIVE), pinning
  // every capped core at 100% even between generation phases — part of the
  // sustained-load profile implicated in the Arrow Lake crashes
  // (docs/feature/engine-stability.md). PASSIVE parks waiting threads in the
  // OS scheduler instead; same operator-override rule as the thread cap.
  if (!isNode && !env.OMP_WAIT_POLICY) env.OMP_WAIT_POLICY = 'PASSIVE'

  const file = isNode ? process.execPath : binPath
  const headArgs = isNode ? [binPath] : []
  const args = [...headArgs, ...userArgs, portArg, String(cfg.port)]

  // Run from the version folder so a native engine resolves its co-located DLLs
  // (Windows) and a relative --models path against its own install tree.
  const child = spawn(file, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })

  // Drain AND record stdout/stderr to a per-sidecar log. Draining is not
  // optional: an unread pipe stalls the child once its buffer fills (a native
  // engine prints a lot while loading multi-GB weights). { end: false } keeps
  // the file open across both streams; the child's exit closes it.
  const out = sidecarLog(cfg.id)
  out.write(
    `\n=== launch ${new Date().toISOString()} :: ${cfg.exec.bin} ${args.join(' ')} (port ${cfg.port}) ===\n`
  )
  child.stdout.pipe(out, { end: false })
  child.stderr.pipe(out, { end: false })
  child.once('exit', (code, signal) => {
    out.end(`=== exit code=${code} signal=${signal} @ ${new Date().toISOString()} ===\n`)
  })

  return child
}
