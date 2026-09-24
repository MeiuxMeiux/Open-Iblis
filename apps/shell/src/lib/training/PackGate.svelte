<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { PluginInstallQueueSnapshot } from '../../../shared/plugin-install-queue'
  import Sigil from '../Sigil.svelte'

  const TRAINING_PACK_ID = 'mx.iblis.training.acestep'

  let { onInstalled }: { onInstalled: () => void } = $props()

  let available = $state<{ version: string; name: string } | null>(null)
  let checked = $state(false)
  let submitting = $state(false)
  let percent = $state(0)
  let error = $state<string | null>(null)
  let queue = $state<PluginInstallQueueSnapshot>({ entries: [], history: [] })
  const transfer = $derived(queue.entries.find((entry) => entry.id === TRAINING_PACK_ID))
  const busy = $derived(submitting || transfer !== undefined)

  async function check(): Promise<void> {
    error = null
    try {
      const result = await window.iblis.catalog.list()
      if (result.ok) {
        const entry = result.data.plugins.find((p) => p.manifest.id === TRAINING_PACK_ID)
        available = entry ? { version: entry.manifest.version, name: entry.manifest.name } : null
      } else {
        error = result.error
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    checked = true
  }

  $effect(() => {
    void check()
    void window.iblis.plugins.installQueue().then((result) => {
      if (result.ok) queue = result.data
    })
    const off = window.iblis.plugins.onInstallProgress((p) => {
      if (p.id === TRAINING_PACK_ID) percent = p.percent
    })
    const offQueue = window.iblis.plugins.onInstallQueue((snapshot) => (queue = snapshot))
    return () => {
      off()
      offQueue()
    }
  })

  async function install(): Promise<void> {
    if (!available || busy) return
    submitting = true
    percent = 0
    error = null
    const result = await window.iblis.plugins.install(TRAINING_PACK_ID, available.version)
    submitting = false
    if (result.ok) onInstalled()
    else error = result.error
  }
</script>

<div class="gate">
  <div class="sigil" aria-hidden="true"><Sigil size={44} /></div>
  <p class="muted">
    Training needs the training pack — a separate, removable download with the stem, tagging, and
    training tools. Generating music never depends on it.
  </p>
  {#if transfer}
    <p class="muted" role="status">
      {transfer.phase === 'queued'
        ? `Queued for download${transfer.position > 1 ? ` · ${transfer.position - 1} ahead` : ''}`
        : `Installing ${percent}%`}
    </p>
    <button
      class="cancel"
      onclick={() => void window.iblis.plugins.cancelInstall(TRAINING_PACK_ID)}
    >
      Cancel download
    </button>
  {:else if !checked}
    <p class="muted">Checking the catalog…</p>
  {:else if available}
    <button class="install" onclick={install} disabled={busy}>
      {busy ? `Installing ${percent}%` : `Install training pack ${available.version}`}
    </button>
  {:else}
    <p class="muted">The training pack is not in the catalog yet. Check back after an update.</p>
    <button class="retry" onclick={check}>Check again</button>
  {/if}
  {#if error}<p class="warn" role="alert">{error}</p>{/if}
</div>

<style>
  .gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 12px;
    padding: 40px 0;
  }
  .sigil {
    color: var(--color-accent);
    opacity: 0.5;
  }
  .muted {
    margin: 0;
    max-width: 420px;
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
  .warn {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-state-danger);
  }
  .install {
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    padding: 9px 22px;
    border-radius: var(--radius-lg);
    font-size: 14px;
  }
  .install:disabled {
    opacity: 0.4;
  }
  .retry {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 7px 16px;
    border-radius: var(--radius-lg);
    font-size: 13px;
  }
  .retry:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
  }
  .cancel {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 7px 16px;
    border-radius: var(--radius-lg);
    font-size: 13px;
  }
  .cancel:hover {
    border-color: var(--color-state-danger);
    color: var(--color-state-danger);
  }
</style>
