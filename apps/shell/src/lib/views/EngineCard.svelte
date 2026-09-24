<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { InstalledEngineSummary } from '../../../shared/contract'

  // One installed engine as a card: signed facts (publisher, license, models,
  // what Create can send it) plus live readiness. Selecting it changes the
  // default target for NEW takes only; queued work keeps its own target.
  let {
    engine,
    selectable,
    disabled,
    onselect
  }: {
    engine: InstalledEngineSummary
    selectable: boolean
    disabled: boolean
    onselect: (id: string) => void
  } = $props()

  const READINESS: Record<InstalledEngineSummary['readiness'], string> = {
    running: 'Running',
    busy: 'Busy',
    ready: 'Ready, starts on demand',
    stopped: 'Installed, not running'
  }

  function gigabytes(bytes: number): string {
    if (bytes <= 0) return 'size unknown'
    const gb = bytes / 1_073_741_824
    return gb >= 1 ? `${gb.toFixed(1)} GB on disk` : `${Math.round(bytes / 1_048_576)} MB on disk`
  }

  const takes = $derived(
    [
      engine.lyrics ? 'lyrics' : 'instrumental only',
      engine.styles ? 'styles' : 'no styles',
      engine.duration ? `${engine.duration.minSec} to ${engine.duration.maxSec} s` : null
    ].filter((entry): entry is string => entry !== null)
  )
</script>

<button
  type="button"
  class="card"
  class:selected={engine.selected}
  class:static={!selectable}
  role={selectable ? 'radio' : undefined}
  aria-checked={selectable ? engine.selected : undefined}
  disabled={disabled || !selectable}
  onclick={() => onselect(engine.id)}
>
  <div class="head">
    <span class="name">{engine.name}</span>
    <span class="version">{engine.version}</span>
    <span class="state" class:live={engine.readiness === 'running' || engine.readiness === 'busy'}>
      {READINESS[engine.readiness]}
    </span>
  </div>
  <div class="facts">
    <span>{engine.publisher}</span>
    <span>{engine.license}</span>
    <span>local, contract v{engine.protocol}</span>
    <span>{gigabytes(engine.installBytes)}</span>
  </div>
  <div class="facts">
    <span>Takes: {takes.join(', ')}</span>
  </div>
  {#if engine.models.length > 0}
    <div class="facts models">
      <span>Models: {engine.models.join(', ')}</span>
    </div>
  {/if}
</button>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 10px 12px;
    text-align: left;
    color: var(--color-text-primary);
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    font: inherit;
    cursor: pointer;
  }
  .card.static {
    cursor: default;
  }
  .card:not(.static):hover {
    border-color: var(--color-accent);
  }
  .card.selected {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 1px var(--color-accent);
  }
  .card:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .card:disabled:not(.static) {
    opacity: 0.65;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
  }
  .name {
    font-weight: 600;
    font-size: 13.5px;
  }
  .version,
  .facts {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .state {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--color-text-secondary);
  }
  .state.live {
    color: var(--color-accent);
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .models {
    word-break: break-word;
  }
</style>
