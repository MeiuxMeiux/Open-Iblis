// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

import type { ChildProcess } from 'node:child_process'
import type { PluginManifest } from '@iblis/plugin-sdk'
import { spawnSidecar } from './spawn'
import { waitForHealth } from './health'
import { freePort } from './port'
import { sessionSecret } from './secret'

const DEFAULT_HEALTH_PATH = '/health'
const DEFAULT_HEALTH_TIMEOUT_MS = 5000

export interface Instance {
  id: string
  version: string
  port: number
  secret: string
  child: ChildProcess
}

// Spawn a sidecar on a fresh port and resolve only once it reports healthy.
// If it never comes up, the child is killed so we never leak a zombie.
export async function launch(manifest: PluginManifest): Promise<Instance> {
  const exec = manifest.executable
  if (!exec) throw new Error(`${manifest.id} has no executable to launch`)

  const port = await freePort()
  const secret = sessionSecret()
  const child = spawnSidecar({ id: manifest.id, version: manifest.version, exec, port, secret })

  // Watch the child for an early exit. A native engine that dies on launch (e.g.
  // a missing DLL, code=0xC0000135) is gone in ~20 ms — without this, waitForHealth
  // would poll a dead port for the full health timeout (up to 5 min) and then throw
  // an opaque "timeout", masking the real crash. Racing the exit surfaces the true
  // failure immediately. The listener is detached once health resolves either way.
  let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  const exited = new Promise<never>((_, reject) => {
    onExit = (code, signal): void =>
      reject(new Error(`sidecar exited before healthy (code=${code} signal=${signal})`))
    child.once('exit', onExit)
  })

  try {
    await Promise.race([
      waitForHealth(
        port,
        exec.healthPath ?? DEFAULT_HEALTH_PATH,
        secret,
        exec.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
      ),
      exited
    ])
  } catch (e) {
    child.kill('SIGKILL')
    throw e
  } finally {
    if (onExit) child.removeListener('exit', onExit)
  }

  return { id: manifest.id, version: manifest.version, port, secret, child }
}
