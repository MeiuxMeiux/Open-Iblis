<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { LibraryTrack } from '../../../shared/contract'
  import Icon from '../ui/Icon.svelte'

  let {
    tracks,
    value,
    onSelect
  }: {
    tracks: LibraryTrack[]
    value: string
    onSelect: (id: string) => void
  } = $props()

  let open = $state(false)
  let root: HTMLDivElement | undefined
  const selected = $derived(tracks.find((track) => track.id === value) ?? null)

  function choose(id: string): void {
    onSelect(id)
    open = false
  }

  function outside(event: PointerEvent): void {
    if (root && event.target instanceof Node && !root.contains(event.target)) open = false
  }

  function keyboard(event: KeyboardEvent): void {
    if (event.key === 'Escape') open = false
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={keyboard} />

<div class="picker" bind:this={root}>
  <span class="label" id="benchmark-track-label">Immutable WAV track</span>
  <button
    type="button"
    class="current"
    aria-labelledby="benchmark-track-label"
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span>{selected?.name ?? 'Choose a WAV track'}</span>
    <Icon name={open ? 'chevron-up' : 'chevron-down'} size={15} />
  </button>
  {#if open}
    <div class="options" role="listbox" aria-labelledby="benchmark-track-label">
      {#each tracks as track (track.id)}
        <button
          type="button"
          role="option"
          aria-selected={track.id === value}
          onclick={() => choose(track.id)}
        >
          <span>{track.name}</span>
          {#if track.id === value}<span class="selected">Selected</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .label {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  button {
    min-height: 34px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    padding: 6px var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
    text-align: left;
  }
  .current {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .current span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .options {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    left: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 240px;
    overflow-y: auto;
    padding: var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
    box-shadow: var(--shadow-md);
  }
  .options button {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    border-color: transparent;
    background: transparent;
  }
  .options button:hover,
  .options button[aria-selected='true'] {
    background: var(--color-bg-subtle);
  }
  .selected {
    color: var(--color-accent);
    font-size: var(--font-size-xs);
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
