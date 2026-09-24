<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Settings → Diagnostics developer gate. This cannot select an adapter for
  // Create; it names only one managed library record for a temporary proof.
  import { onMount } from 'svelte'
  import type {
    AdapterCompatibilityProof,
    AdapterProofProgress,
    ImportedAdapterRecord
  } from '../../../shared/adapters'

  let adapters = $state<ImportedAdapterRecord[]>([])
  let selectedId = $state('')
  let busy = $state(false)
  let progress = $state<AdapterProofProgress | null>(null)
  let result = $state<AdapterCompatibilityProof | null>(null)
  let error = $state('')

  onMount(() => {
    const unsubscribe = window.iblis.adapters.onCompatibilityProofProgress((next) => {
      progress = next
    })
    void refresh()
    return unsubscribe
  })

  async function refresh(): Promise<void> {
    const response = await window.iblis.adapters.list()
    if (!response.ok) {
      error = response.error
      return
    }
    adapters = response.data
    if (!adapters.some((adapter) => adapter.id === selectedId)) selectedId = adapters[0]?.id ?? ''
  }

  async function run(): Promise<void> {
    if (!selectedId) return
    busy = true
    error = ''
    result = null
    progress = { stage: 'validating', detail: 'Preparing compatibility proof…' }
    const response = await window.iblis.adapters.runCompatibilityProof(selectedId)
    busy = false
    if (!response.ok) {
      error = response.error
      return
    }
    result = response.data
    if (!result) progress = null
  }

  async function reveal(): Promise<void> {
    if (!result) return
    const response = await window.iblis.adapters.revealCompatibilityProof(result.proofId)
    if (!response.ok) error = response.error
  }
</script>

<section class="compatibility" aria-labelledby="compatibility-heading">
  <h3 id="compatibility-heading">Engine compatibility</h3>
  <p class="hint">
    Developer gate for one acknowledged local adapter. It pauses Create, restarts the exact ACE-Step
    0.1.4 pack with empty and temporary adapter roots, then restores the ordinary engine. It does
    not enable the adapter for generation.
  </p>

  {#if adapters.length > 0}
    <label class="field">
      <span>Acknowledged adapter record</span>
      <select bind:value={selectedId} disabled={busy}>
        {#each adapters as adapter (adapter.id)}
          <option value={adapter.id}>{adapter.displayName} — {adapter.sha256.slice(0, 12)}…</option>
        {/each}
      </select>
    </label>
    <button class="run" type="button" disabled={busy || !selectedId} onclick={run}>
      {busy ? 'Compatibility proof running…' : 'Run compatibility proof'}
    </button>
  {:else}
    <p class="muted">
      Import and acknowledge one local adapter before running this developer gate.
    </p>
  {/if}

  {#if progress}
    <p class="status" aria-live="polite">{progress.detail}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">Compatibility proof failed: {error}</p>
  {/if}
  {#if result}
    <div class="result">
      <p><strong>Completed.</strong> Proof <code>{result.proofId}</code> was saved locally.</p>
      <p>
        Adapter registry: <code>{result.selectedAdapter}</code>. Empty root: {result.empty.adapters
          .length}; loaded root: {result.loaded.adapters.length}. Startup: {result.empty.startupMs} ms
        / {result.loaded.startupMs} ms.
      </p>
      <p>
        GPU memory: {result.empty.vramMb ?? 'unavailable'} MB / {result.loaded.vramMb ??
          'unavailable'} MB. Same-blueprint comparison: <code>{result.audio.firstId}</code> /
        <code>{result.audio.secondId}</code>.
      </p>
      <button type="button" class="reveal" onclick={reveal}>Reveal A/B audio</button>
    </div>
  {/if}
</section>

<style>
  .compatibility {
    margin-top: 22px;
    padding-top: 20px;
    border-top: 1px solid var(--color-border-default);
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
  }
  .hint,
  .muted,
  .status,
  .error,
  .result {
    font-size: 12.5px;
    line-height: 1.5;
  }
  .hint,
  .muted {
    margin: 6px 0 14px;
    color: var(--color-text-secondary);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 520px;
  }
  .field span {
    color: var(--color-text-secondary);
    font-size: 12px;
  }
  select {
    min-width: 0;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    padding: 9px 11px;
    font: inherit;
  }
  .run {
    margin-top: 10px;
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    border-radius: var(--radius-lg);
    color: var(--color-text-inverse);
    padding: 8px 14px;
    font-size: 13px;
  }
  .run:disabled {
    opacity: 0.5;
  }
  .status,
  .error,
  .result {
    margin: 12px 0 0;
  }
  .status {
    color: var(--color-text-secondary);
  }
  .error {
    color: var(--color-danger, var(--color-text-primary));
  }
  .result {
    border-left: 2px solid var(--color-accent);
    padding-left: 10px;
    color: var(--color-text-secondary);
  }
  .result p {
    margin: 0 0 7px;
  }
  .reveal {
    border: 1px solid var(--color-border-default);
    background: var(--app-surface);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    padding: 6px 10px;
    font: inherit;
    font-size: 12px;
  }
  code {
    user-select: text;
  }
</style>
