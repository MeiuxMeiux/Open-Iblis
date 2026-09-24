<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { ImportedAdapterRecord } from '../../../shared/adapters'
  import { MAX_ACTIVE_STYLES } from '../../../shared/styles'
  import type { Steering } from '../views/steering.svelte'
  import Badge from '../ui/Badge.svelte'
  import StyleBrowseModal from './StyleBrowseModal.svelte'
  import StylePickerList from './StylePickerList.svelte'
  import { pickerEntries, type PickerEntry } from './picker-entries'

  let {
    steering,
    liveAdapters,
    disabled
  }: {
    steering: Steering
    // The engine's live registry (runtime.adapters); null while unknown.
    liveAdapters: string[] | null
    disabled: boolean
  } = $props()

  let records = $state<ImportedAdapterRecord[]>([])
  let query = $state('')
  let open = $state(false)
  let browseOpen = $state(false)
  let restarting = $state(false)
  let fallbackNote = $state<string | null>(null)

  async function load(): Promise<void> {
    const result = await window.iblis.adapters.list()
    if (result.ok) records = result.data
  }

  $effect(() => {
    void load()
  })

  const entries = $derived(pickerEntries(records, liveAdapters, query))
  const selected = $derived(
    entries.find((entry) => entry.registryName === steering.adapter) ?? null
  )

  // Remix honesty: a restored take may name a style that no longer exists
  // locally. A style that exists but is not loaded is the restart case, not
  // the missing case.
  $effect(() => {
    if (!steering.adapter || liveAdapters === null || records.length === 0) return
    const known = entries.some((entry) => entry.registryName === steering.adapter)
    const live = liveAdapters.includes(steering.adapter)
    if (!known && !live) {
      steering.adapter = ''
      steering.adapterScale = null
      fallbackNote =
        'The style this take used is no longer in your library — continuing without a style.'
    }
  })

  function select(entry: PickerEntry | null): void {
    fallbackNote = null
    if (!entry) {
      steering.adapter = ''
      steering.adapterScale = null
    } else {
      steering.adapter = entry.registryName
    }
    open = false
  }

  async function restartEngine(): Promise<void> {
    if (restarting) return
    restarting = true
    await window.iblis.perf.restartEngine()
    restarting = false
  }
</script>

<div class="picker">
  <div class="head">
    <span class="label">Style</span>
    <span
      class="why"
      title={`This engine version loads ${MAX_ACTIVE_STYLES} style at a time — selecting another swaps it.`}
    >
      why one?
    </span>
  </div>
  <button
    class="current"
    onclick={() => (open = !open)}
    disabled={disabled && !selected}
    aria-expanded={open}
  >
    {#if selected}
      <span class="name">{selected.record.displayName}</span>
      <Badge tone={selected.originLabel === 'Yours' ? 'accent' : 'neutral'}>
        {selected.originLabel}
      </Badge>
    {:else}
      <span class="name none">None</span>
    {/if}
  </button>

  {#if open}
    <StylePickerList
      {entries}
      {selected}
      bind:query
      {restarting}
      onSelect={select}
      onBrowse={() => (browseOpen = true)}
      onRestart={restartEngine}
    />
  {/if}

  {#if selected}
    <label class="scale">
      <span>Scale</span>
      <input
        type="number"
        min="0"
        max="2"
        step="0.05"
        bind:value={steering.adapterScale}
        placeholder="1.0"
        {disabled}
      />
    </label>
  {/if}
  {#if fallbackNote}<p class="note" role="status">{fallbackNote}</p>{/if}
</div>

{#if browseOpen}
  <StyleBrowseModal onClose={() => ((browseOpen = false), void load())} />
{/if}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 170px;
    flex: 1 1 170px;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .label {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .why {
    font-size: 11px;
    color: var(--color-text-muted);
    cursor: help;
  }
  .current {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 11px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    font-size: 13.5px;
    text-align: left;
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
  .scale {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .scale span {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .scale input {
    width: 90px;
    padding: 7px 9px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font: inherit;
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
</style>
