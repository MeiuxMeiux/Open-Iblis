<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { InstallProgress, SidecarHealth } from '../../../shared/contract'
  import type { PluginInstallQueueEntry } from '../../../shared/plugin-install-queue'
  import { isInstalled, isRollbackable, isUpdatable, type PluginRow } from './version'
  import Badge from '../ui/Badge.svelte'

  let {
    row,
    health,
    busy,
    progress,
    queue,
    onInstall,
    onUpdate,
    onRollback,
    onRemove,
    onCancel
  }: {
    row: PluginRow
    health: SidecarHealth | null
    busy: boolean
    progress: InstallProgress | null
    queue: PluginInstallQueueEntry | null
    onInstall: () => void
    onUpdate: () => void
    onRollback: () => void
    onRemove: () => void
    onCancel: () => void
  } = $props()

  let installed = $derived(isInstalled(row))
  let updatable = $derived(isUpdatable(row))
  let rollbackable = $derived(isRollbackable(row))

  const fmtBytes = (n: number): string => {
    if (n < 1024) return `${n} B`
    const units = ['KB', 'MB', 'GB']
    let v = n / 1024
    let u = 0
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024
      u++
    }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`
  }

  // Caption under the bar: overall bytes when known, else the current asset's;
  // names the asset and its position when a manifest declares several.
  let caption = $derived.by(() => {
    if (!progress) return ''
    const multi =
      progress.assetCount > 1 ? ` · ${progress.assetIndex + 1}/${progress.assetCount}` : ''
    if (progress.overallTotal) {
      return `${fmtBytes(progress.overallReceived)} / ${fmtBytes(progress.overallTotal)}${multi}`
    }
    return `${fmtBytes(progress.received)}${multi}`
  })

  // Status dot: green = sidecar healthy, red = crashed (breaker open), grey =
  // not running. Hidden for plugins that have no sidecar at all.
  let dot = $derived.by(() => {
    if (!installed || !health) return null
    if (health.breakerOpen) return { cls: 'down', label: 'Sidecar crashed — not restarting' }
    if (health.running) return { cls: 'up', label: `Running on port ${health.port}` }
    return { cls: 'idle', label: 'Sidecar stopped' }
  })
</script>

<article class="card" class:busy>
  <div class="meta">
    <div class="head">
      <span class="name">{row.name}</span>
      <span class="kind">{row.kind}</span>
    </div>
    <div class="state">
      {#if dot}
        <span class="dot {dot.cls}" title={dot.label}></span>
      {/if}
      {#if installed}
        Active {row.activeVersion}
        {#if updatable}<Badge tone="accent" variant="outline">update {row.latest}</Badge>{/if}
      {:else}
        Available {row.latest}
      {/if}
    </div>
    {#if row.analysisCapabilities.length}
      <div class="analysis" aria-label="Audio analysis capabilities">
        {#each row.analysisCapabilities as capability (capability)}
          <Badge variant="outline">{capability === 'bpm-detect' ? 'BPM' : 'Key'}</Badge>
        {/each}
      </div>
    {/if}

    {#if queue && !progress}
      <p class="queue-state" role="status">
        {queue.phase === 'queued'
          ? `Queued for download${queue.position > 1 ? ` · ${queue.position - 1} ahead` : ''}`
          : 'Preparing download…'}
      </p>
    {:else if progress}
      <div class="progress" aria-label="Installing">
        <div class="track">
          <div
            class="fill"
            class:indeterminate={!progress.overallTotal}
            style={progress.overallTotal ? `width:${progress.percent}%` : ''}
          ></div>
        </div>
        <span class="caption">
          {progress.overallTotal ? `${progress.percent}%` : 'Downloading'} · {caption}
        </span>
      </div>
    {/if}
  </div>

  <div class="actions">
    {#if queue ?? progress}
      <button class="danger" onclick={onCancel}>Cancel</button>
    {:else if !installed}
      <button class="primary" disabled={busy} onclick={onInstall}>Install</button>
    {:else}
      {#if updatable}
        <button class="primary" disabled={busy} onclick={onUpdate}>Update</button>
      {/if}
      {#if rollbackable}
        <button disabled={busy} onclick={onRollback}>Roll back</button>
      {/if}
      <button class="danger" disabled={busy} onclick={onRemove}>Remove</button>
    {/if}
  </div>
</article>

<style>
  .card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 14px 16px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  .card.busy {
    opacity: 0.55;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .name {
    font-size: 15px;
    color: var(--color-text-primary);
  }
  .kind {
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  .state {
    margin-top: 6px;
    font-size: 12.5px;
    color: var(--color-text-secondary);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .analysis {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--color-text-secondary);
  }
  .dot.up {
    background: var(--color-state-success);
  }
  .dot.down {
    background: var(--color-state-danger);
  }
  .dot.idle {
    background: var(--color-text-secondary);
    opacity: 0.5;
  }
  .progress {
    margin-top: 9px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .track {
    height: 4px;
    border-radius: 999px;
    background: var(--app-surface-hover);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--color-accent);
    border-radius: 999px;
    transition: width 0.18s ease;
  }
  .fill.indeterminate {
    width: 35%;
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    0% {
      margin-left: -35%;
    }
    100% {
      margin-left: 100%;
    }
  }
  .caption {
    font-size: 11.5px;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .queue-state {
    margin: 9px 0 0;
    color: var(--color-text-secondary);
    font-size: 11.5px;
  }

  .actions {
    display: flex;
    gap: 8px;
    flex: 0 0 auto;
  }
  button {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-primary);
    padding: 6px 14px;
    border-radius: var(--radius-lg);
    font-size: 13px;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      opacity 0.12s ease;
  }
  button:hover:not(:disabled) {
    background: var(--app-surface-hover);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.primary {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  button.primary:hover:not(:disabled) {
    background: var(--color-accent);
    color: var(--color-text-inverse);
  }
  button.danger:hover:not(:disabled) {
    border-color: var(--color-state-danger);
    color: var(--color-state-danger);
  }
</style>
