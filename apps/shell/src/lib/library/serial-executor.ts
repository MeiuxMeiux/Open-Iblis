// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

export type SerialExecutor = <T>(operation: () => Promise<T>) => Promise<T>

// Renderer IPC can settle out of order even though main persists mutations in
// order. Apply Library snapshots and mutation results through one queue so a
// slow refresh cannot overwrite a newer row or folder result.
export function createSerialExecutor(): SerialExecutor {
  let chain = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = chain.then(operation)
    chain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

export function createRefreshExecutor(
  load: () => Promise<void>,
  execute: SerialExecutor
): () => Promise<void> {
  let requested = 0
  let active: Promise<void> | null = null
  return (): Promise<void> => {
    requested++
    if (active) return active
    let handled = 0
    const run = execute(async () => {
      try {
        while (handled < requested) {
          handled = requested
          await load()
        }
      } finally {
        // Clear before this queued operation settles. A refresh can otherwise
        // arrive in the microtask between the final load and a .then cleanup,
        // observe a completed `active`, and never schedule its requested load.
        active = null
      }
    })
    active = run
    return run
  }
}
