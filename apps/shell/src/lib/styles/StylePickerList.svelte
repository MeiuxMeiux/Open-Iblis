<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import Badge from '../ui/Badge.svelte'
  import type { PickerEntry } from './picker-entries'

  let {
    entries,
    selected,
    query = $bindable(''),
    restarting,
    onSelect,
    onBrowse,
    onRestart
  }: {
    entries: PickerEntry[]
    selected: PickerEntry | null
    query?: string
    restarting: boolean
    onSelect: (entry: PickerEntry | null) => void
    onBrowse: () => void
    onRestart: () => void
  } = $props()
</script>

<div class="list" role="listbox" aria-label="Styles">
  <input type="text" placeholder="Search styles" bind:value={query} aria-label="Search styles" />
  <button class="none-row" role="option" aria-selected={!selected} onclick={() => onSelect(null)}>
    <span class="name none">None</span>
  </button>
  {#each entries as entry (entry.record.id)}
    <div class="row" class:unloaded={!entry.loaded}>
      <button
        class="pick"
        role="option"
        aria-selected={entry === selected}
        disabled={!entry.loaded}
        title={entry.loaded
          ? selected && entry !== selected
            ? `Swaps out ${selected.record.displayName} — one style at a time.`
            : undefined
          : 'Restart the engine to load this style.'}
        onclick={() => onSelect(entry)}
      >
        <span class="name">{entry.record.displayName}</span>
        <Badge tone="neutral" variant="outline">{entry.category}</Badge>
        <Badge tone={entry.originLabel === 'Yours' ? 'accent' : 'neutral'}>
          {entry.originLabel}
        </Badge>
      </button>
      {#if !entry.loaded}
        <button class="restart" onclick={onRestart} disabled={restarting}>
          {restarting ? 'Restarting…' : 'Restart engine'}
        </button>
      {/if}
    </div>
  {/each}
  {#if entries.length === 0}
    <p class="empty">No styles in your library yet.</p>
  {/if}
  <button class="browse" onclick={onBrowse}>Browse more…</button>
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
    padding: 8px;
  }
  .list input {
    padding: 7px 9px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 12.5px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pick,
  .none-row {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: 13px;
    text-align: left;
  }
  .pick:hover:not(:disabled),
  .none-row:hover {
    background: var(--color-bg-subtle);
  }
  .pick:disabled {
    opacity: 0.55;
  }
  .name {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name.none {
    color: var(--color-text-secondary);
  }
  .restart {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 5px 10px;
    border-radius: var(--radius-md);
    font-size: 11.5px;
    white-space: nowrap;
  }
  .empty {
    margin: 0;
    padding: 6px 9px;
    font-size: 12.5px;
    color: var(--color-text-muted);
  }
  .browse {
    align-self: flex-start;
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 6px 12px;
    border-radius: var(--radius-md);
    font-size: 12.5px;
  }
  .browse:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
  }
</style>
