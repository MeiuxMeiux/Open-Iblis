// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// Pure navigation and link policy for the main window (security audit
// 2026-09-24, M-SHL2/M-SHL3/L-SHL7). Kept free of Electron so it unit-tests
// directly; window.ts wires it to the real events.

// Links the renderer asks to open leave through the OS browser. Only https
// reaches shell.openExternal: file:, UNC, and OS protocol handlers (ms-msdt:,
// search-ms:, ...) run native code outside the sandbox on Windows.
export function externalUrlAllowed(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

// The window only ever shows the bundled renderer. A navigation is allowed
// only when it stays on the current document (a reload, or a fragment jump
// Chromium already treats as in-page); anything else, such as a dropped HTML
// file or a stray link, would inherit the preload's privileged API.
export function sameDocument(target: string, current: string): boolean {
  try {
    const a = new URL(target)
    const b = new URL(current)
    a.hash = ''
    b.hash = ''
    return a.href === b.href
  } catch {
    return false
  }
}

// The dev-server URL override exists for `electron-vite dev` and the unpackaged
// E2E harness. A packaged build ignores it, so an environment variable can
// never point the privileged window at an arbitrary page.
export function rendererDevUrl(
  env: Record<string, string | undefined>,
  isPackaged: boolean
): string | null {
  if (isPackaged) return null
  const url = env.ELECTRON_RENDERER_URL
  return url !== undefined && url !== '' ? url : null
}
