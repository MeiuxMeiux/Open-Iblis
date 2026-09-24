// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: GPL-3.0-or-later

// The shell's top-level views. Defined here (a plain TS module) rather than in
// Nav.svelte so type-aware tooling resolves it without the Svelte compiler.
export type View = 'home' | 'generate' | 'library' | 'styles' | 'training' | 'plugins' | 'settings'

// A tiny cross-tree navigation channel so deep components (a locked gate's
// "Enter a product key" link) can ask the shell to switch views without
// threading an onNavigate prop down every branch. App.svelte owns the actual
// view state and consumes each request; an optional `anchor` deep-links to a
// section inside the target view, which that section consumes once on mount so
// it can scroll itself into view instead of dumping the user at the top.
let requested = $state<View | null>(null)
let anchor = $state<string | null>(null)

export const nav = {
  get requested(): View | null {
    return requested
  },
  go(view: View, target: string | null = null): void {
    requested = view
    anchor = target
  },
  clear(): void {
    requested = null
  },
  // One-shot: a section calls this on mount and, only when it was the requested
  // target, gets `true` back (and the anchor is forgotten) so it scrolls once.
  consumeAnchor(target: string): boolean {
    if (anchor !== target) return false
    anchor = null
    return true
  },
  // Reactive, non-consuming look at the pending anchor: a container view reads
  // this in an effect to reveal the section that will consume it (views stay
  // mounted across tab switches, so mount-time consumption alone is not
  // enough — the anchor can arrive while the view already exists).
  peekAnchor(target: string): boolean {
    return anchor === target
  }
}
