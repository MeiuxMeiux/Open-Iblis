<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { UpdateStatus } from '../../shared/contract'
  import Icon from './ui/Icon.svelte'

  // Global update toast — mounted once at the app root so the "update ready"
  // affordance is reachable from ANY screen, not buried on Home. Auto-update
  // downloads in the background; this surfaces the moment it can be applied and
  // gives a one-click restart. If ignored, electron-updater still applies it on
  // next quit (autoInstallOnAppQuit), so doing nothing is also fine.
  let status = $state<UpdateStatus | null>(null)
  let dismissed = $state(false)

  onMount(() => {
    const unsubscribe = window.iblis.update.onStatus((s) => {
      status = s
      // A fresh meaningful status re-surfaces the toast.
      if (s.state === 'available' || s.state === 'downloading' || s.state === 'ready') {
        dismissed = false
      }
    })
    void window.iblis.update.getStatus().then((result) => {
      if (result.ok) status = result.data
    })
    return unsubscribe
  })

  const restart = (): void => void window.iblis.update.install()

  // Only show for states the user can act on or wants to see progress for.
  const visible = $derived(
    !dismissed &&
      !!status &&
      (status.state === 'available' || status.state === 'downloading' || status.state === 'ready')
  )
</script>

{#if visible && status}
  <div class="toast" class:ready={status.state === 'ready'} role="status" aria-live="polite">
    <div class="dot" aria-hidden="true"></div>
    <div class="body">
      {#if status.state === 'available'}
        <strong>Update {status.version}</strong>
        <span class="sub">checking signature…</span>
      {:else if status.state === 'downloading'}
        <strong>Downloading update</strong>
        <span class="sub">{status.percent}%</span>
      {:else if status.state === 'ready'}
        <strong>Update {status.version} ready</strong>
        <span class="sub">restart to apply</span>
      {/if}
    </div>
    {#if status.state === 'ready'}
      <button class="go" onclick={restart}>
        <Icon name="refresh" size={14} />
        <span>Restart now</span>
      </button>
    {/if}
    <button class="x" aria-label="Dismiss" title="Dismiss" onclick={() => (dismissed = true)}>
      <Icon name="close" size={14} />
    </button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 380px;
    padding: 12px 14px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
    font-size: 13px;
    color: var(--color-text-primary);
  }
  .toast.ready {
    border-color: var(--color-accent);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
    flex: 0 0 auto;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-right: 4px;
  }
  .body strong {
    font-weight: 600;
  }
  .sub {
    font-size: 11.5px;
    color: var(--color-text-secondary);
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    padding: 6px 14px;
    border-radius: var(--radius-lg);
    font-size: 12.5px;
    white-space: nowrap;
  }
  .x {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    line-height: 1;
    padding: 0;
    cursor: pointer;
  }
  .x:hover {
    color: var(--color-text-primary);
  }
</style>
