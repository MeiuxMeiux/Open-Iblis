<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Browse-more modal for Create: the community-trainings browser, scoped to
  // our signed index only (curated offers live in Styles). Reuses
  // TrainingsSection so remote browsing has exactly one implementation.
  import { tick } from 'svelte'
  import TrainingsSection from './TrainingsSection.svelte'
  import type { StyleFilters } from './filters'

  let { onClose }: { onClose: () => void } = $props()

  let panel = $state<HTMLDivElement | null>(null)
  let search = $state('')
  let tab = $state<StyleFilters['category']>('all')

  const filters = $derived<StyleFilters>({ query: search, category: tab, origins: [] })

  $effect(() => {
    void tick().then(() => panel?.focus())
  })

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onClose()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<button class="scrim" aria-label="Close style browser" onclick={onClose}></button>
<div
  class="panel"
  role="dialog"
  aria-modal="true"
  aria-label="Browse community trainings"
  tabindex="-1"
  bind:this={panel}
>
  <header>
    <h2>Community trainings</h2>
    <button class="close" onclick={onClose}>Close</button>
  </header>
  <div class="controls">
    <input type="text" placeholder="Search trainings" bind:value={search} aria-label="Search" />
    <div class="tabs" role="tablist" aria-label="Category">
      {#each [['all', 'All'], ['texture', 'Texture'], ['groove', 'Groove']] as const as [id, label] (id)}
        <button
          role="tab"
          aria-selected={tab === id}
          class:active={tab === id}
          onclick={() => (tab = id)}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>
  <div class="body">
    <TrainingsSection {filters} />
    <p class="hint">
      A downloaded training joins your library immediately; restart the engine from the picker to
      make it selectable.
    </p>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: 0;
    background: color-mix(in srgb, var(--color-bg-base) 88%, transparent);
  }
  .panel {
    position: fixed;
    z-index: 41;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(680px, calc(100vw - 48px));
    max-height: min(80vh, 720px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 20px;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .close {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 6px 14px;
    border-radius: var(--radius-lg);
    font-size: 12.5px;
  }
  .controls {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .controls input {
    flex: 1 1 auto;
    padding: 8px 10px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 13px;
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    border: 1px solid var(--color-border-subtle);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 6px 12px;
    border-radius: var(--radius-full);
    font-size: 12px;
  }
  .tabs button.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .body {
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-muted);
  }
</style>
