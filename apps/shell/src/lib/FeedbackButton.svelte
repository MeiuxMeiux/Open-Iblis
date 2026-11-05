<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Titlebar "Feedback" button: always visible, one click from anywhere.
  // Each choice opens the website form in the browser (main builds the URL
  // with version, OS, arch, and GPU). Mirrors Help in the app menu and
  // Settings -> Feedback.
  import type { FeedbackKind } from '../../shared/feedback'
  import Icon from './ui/Icon.svelte'

  let open = $state(false)
  let notice = $state<string | null>(null)

  const choices: { kind: FeedbackKind; label: string }[] = [
    { kind: 'bug', label: 'Report a bug' },
    { kind: 'feature', label: 'Request a feature' },
    { kind: 'question', label: 'Ask a question' }
  ]

  async function choose(kind: FeedbackKind): Promise<void> {
    open = false
    const r = await window.iblis.feedback.open(kind, false)
    notice = r.ok ? null : `Could not open the browser: ${r.error}`
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') open = false
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="feedback">
  <button
    type="button"
    class="trigger"
    aria-label="Send feedback"
    aria-haspopup="menu"
    aria-expanded={open}
    title={notice ?? 'Found a bug? Want a feature?'}
    onclick={() => (open = !open)}
  >
    <Icon name="mail" size={13} />
    <span>Feedback</span>
  </button>
  {#if open}
    <div class="menu" role="menu">
      {#each choices as c (c.kind)}
        <button type="button" role="menuitem" onclick={() => void choose(c.kind)}>{c.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .feedback {
    position: relative;
    -webkit-app-region: no-drag;
    margin-right: 8px;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--color-border-default);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .trigger:hover,
  .trigger[aria-expanded='true'] {
    border-color: var(--color-accent);
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    padding: 4px;
    border: 1px solid var(--color-border-default);
    border-radius: 6px;
    background: var(--app-surface);
  }
  .menu button {
    padding: 6px 10px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover,
  .menu button:focus-visible {
    background: var(--color-border-default);
  }
</style>
