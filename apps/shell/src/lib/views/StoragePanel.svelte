<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { StorageLocation } from '../../../shared/contract'

  let location = $state<StorageLocation | null>(null)
  let busy = $state(false)
  let error = $state<string | null>(null)

  async function refresh(): Promise<void> {
    const result = await window.iblis.storage.location()
    if (result.ok) location = result.data
    else error = result.error
  }

  async function choose(): Promise<void> {
    busy = true
    error = null
    const result = await window.iblis.storage.chooseLocation()
    busy = false
    if (result.ok) location = result.data
    else error = result.error
  }

  async function restart(): Promise<void> {
    busy = true
    error = null
    const result = await window.iblis.storage.restartToApply()
    if (!result.ok) {
      error = result.error
      busy = false
    }
  }

  onMount(() => void refresh())
</script>

<section class="storage">
  <h2>Data location</h2>
  <p>
    Plugins, model files, generated tracks, adapters, training scratch, and verified catalog caches
    live here. Settings, logs, and protected credentials stay in the Windows app profile.
  </p>

  {#if location}
    <code>{location.dataPath}</code>
    {#if location.pendingDataPath}
      <p class="pending">
        Iblis will move managed data to <code>{location.pendingDataPath}</code> when it restarts.
      </p>
    {/if}
  {:else}
    <p class="muted">Loading the current data location…</p>
  {/if}

  <div class="actions">
    <button disabled={busy} onclick={() => void choose()}>Choose data folder…</button>
    {#if location?.pendingDataPath}
      <button class="primary" disabled={busy} onclick={() => void restart()}
        >Restart and move data</button
      >
    {/if}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .storage h2 {
    margin: 0;
    font-size: 13px;
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  p {
    margin: 6px 0 0;
    color: var(--color-text-secondary);
    font-size: 13px;
    line-height: 1.45;
  }
  code {
    display: block;
    margin-top: 10px;
    overflow-wrap: anywhere;
    color: var(--color-text-primary);
    font-size: 12px;
  }
  .pending {
    color: var(--color-accent);
  }
  .pending code {
    display: inline;
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: 14px;
  }
  button {
    min-height: 34px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-primary);
    padding: 6px var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  button:hover:not(:disabled) {
    background: var(--app-surface-hover);
  }
  button.primary {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  button:disabled {
    cursor: wait;
    opacity: 0.55;
  }
  .error {
    color: var(--color-state-danger);
  }
  .muted {
    font-style: italic;
  }
</style>
