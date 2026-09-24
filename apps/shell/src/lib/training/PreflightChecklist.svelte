<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { TrainingPreflightReport, PreflightStatus } from '../../../shared/training'
  import Badge from '../ui/Badge.svelte'

  // With a provided report (the wizard's scan step) this renders statically;
  // without one it fetches and re-checks on demand (the section overview).
  let { report: provided = null }: { report?: TrainingPreflightReport | null } = $props()

  let fetched = $state<TrainingPreflightReport | null>(null)
  const report = $derived(provided ?? fetched)
  let error = $state<string | null>(null)
  let busy = $state(false)

  const tones: Record<PreflightStatus, 'success' | 'warning' | 'danger'> = {
    pass: 'success',
    warn: 'warning',
    fail: 'danger'
  }
  const words: Record<PreflightStatus, string> = {
    pass: 'Ready',
    warn: 'Warning',
    fail: 'Blocked'
  }

  async function refresh(): Promise<void> {
    if (busy || provided) return
    busy = true
    error = null
    try {
      const result = await window.iblis.training.preflight()
      if (result.ok) fetched = result.data
      else error = result.error
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    busy = false
  }

  $effect(() => {
    void refresh()
  })
</script>

<div class="preflight">
  <div class="head">
    <h2>Hardware check</h2>
    {#if !provided}
      <button class="refresh" onclick={refresh} disabled={busy}>Re-check</button>
    {/if}
  </div>
  {#if error}
    <p class="warn" role="alert">{error}</p>
  {:else if report}
    <ul>
      {#each report.rows as row (row.id)}
        <li>
          <div class="row-head">
            <span class="label">{row.label}</span>
            <Badge tone={tones[row.status]}>{words[row.status]}</Badge>
          </div>
          <p class="detail">{row.detail}</p>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="detail">Measuring…</p>
  {/if}
</div>

<style>
  .preflight {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .refresh {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 5px 12px;
    border-radius: var(--radius-lg);
    font-size: 12.5px;
  }
  .refresh:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
  }
  .refresh:disabled {
    opacity: 0.4;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    padding: 10px 14px;
    background: var(--app-surface);
  }
  .row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .label {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .detail {
    margin: 6px 0 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--color-text-secondary);
  }
  .warn {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-state-danger);
  }
</style>
