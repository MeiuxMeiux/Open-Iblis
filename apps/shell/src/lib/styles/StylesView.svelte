<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import Icon from '../ui/Icon.svelte'
  import LicenseBanner from '../ui/LicenseBanner.svelte'
  import CatalogSection from './CatalogSection.svelte'
  import LibrarySection from './LibrarySection.svelte'
  import LocalImportSection from './LocalImportSection.svelte'
  import TrainingsSection from './TrainingsSection.svelte'
  import type { StyleCategoryTab, StyleFilters, StyleOriginChip } from './filters'

  const tabs: { id: StyleCategoryTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'texture', label: 'Texture' },
    { id: 'groove', label: 'Groove' },
    { id: 'other', label: 'Other' }
  ]
  const chips: { id: StyleOriginChip; label: string }[] = [
    { id: 'trained', label: 'Trained' },
    { id: 'community', label: 'Community' },
    { id: 'experimental', label: 'Experimental' }
  ]

  let query = $state('')
  let category = $state<StyleCategoryTab>('all')
  let origins = $state<StyleOriginChip[]>([])
  // Bumped by any section that changes the local library, so every other
  // section refreshes its installed/downloaded markers.
  let libraryStamp = $state(0)

  let filters = $derived<StyleFilters>({ query, category, origins })

  function toggleOrigin(chip: StyleOriginChip): void {
    origins = origins.includes(chip)
      ? origins.filter((origin) => origin !== chip)
      : [...origins, chip]
  }

  const onLibraryChanged = (): void => void (libraryStamp += 1)
</script>

<section class="styles-view" aria-labelledby="styles-heading">
  <header class="page-head">
    <div class="title-row">
      <div class="title-block">
        <h1 id="styles-heading">Styles</h1>
        <p class="lead">Trained, community, and imported adapters that shape how Create sounds.</p>
      </div>
      <div class="search">
        <Icon name="search" size={16} />
        <input
          type="search"
          placeholder="Search styles"
          aria-label="Search styles"
          bind:value={query}
        />
      </div>
    </div>
    <div class="filter-row">
      <div class="tabs" role="group" aria-label="Category">
        {#each tabs as tab (tab.id)}
          <button
            type="button"
            class="tab"
            aria-pressed={category === tab.id}
            onclick={() => (category = tab.id)}>{tab.label}</button
          >
        {/each}
      </div>
      <div class="chips" role="group" aria-label="Origin">
        {#each chips as chip (chip.id)}
          <button
            type="button"
            class="chip"
            aria-pressed={origins.includes(chip.id)}
            onclick={() => toggleOrigin(chip.id)}
          >
            {#if origins.includes(chip.id)}<Icon name="check" size={12} />{/if}
            {chip.label}
          </button>
        {/each}
      </div>
    </div>
  </header>

  <LicenseBanner />

  <TrainingsSection {filters} {libraryStamp} {onLibraryChanged} />
  <CatalogSection {filters} {libraryStamp} {onLibraryChanged} />
  <LocalImportSection {onLibraryChanged} />
  <LibrarySection {filters} {libraryStamp} {onLibraryChanged} />
</section>

<style>
  .styles-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-6) var(--space-8);
  }

  .page-head {
    display: grid;
    gap: var(--space-4);
    border-bottom: 1px solid var(--color-border-subtle);
    padding-bottom: var(--space-5);
  }
  .title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .title-block {
    display: grid;
    gap: var(--space-1);
  }
  h1 {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-semibold);
  }
  .lead {
    margin: 0;
    max-width: 52ch;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    box-sizing: border-box;
    width: min(300px, 100%);
    min-height: 36px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-inset);
    color: var(--color-text-muted);
    padding: 0 var(--space-3);
    transition: border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .search:focus-within {
    border-color: var(--color-accent);
    color: var(--color-text-secondary);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--color-text-primary);
    padding: 7px 0;
    font: inherit;
    font-size: var(--font-size-sm);
  }
  .search input:focus {
    outline: none;
  }
  .search input::placeholder {
    color: var(--color-text-muted);
  }
  /* Kill the WebKit search widget's clear button so the field reads clean. */
  .search input::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }

  .filter-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .tabs {
    display: inline-flex;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-bg-inset);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .tab,
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    transition:
      background var(--motion-duration-fast) var(--motion-ease-standard),
      border-color var(--motion-duration-fast) var(--motion-ease-standard),
      color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .tab {
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-3);
  }
  .chip {
    border-radius: var(--radius-full);
    border-color: var(--color-border-default);
    padding: var(--space-1) var(--space-3);
  }
  .tab:hover,
  .chip:hover {
    background: var(--app-surface-hover);
    color: var(--color-text-primary);
  }
  .tab:focus-visible,
  .chip:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .tab[aria-pressed='true'] {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
  }
  .chip[aria-pressed='true'] {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
  }

  /* Shared structural vocabulary consumed by the child section components.
     These are :global because the sections are separate components; the
     selectors are namespaced under .styles-view so they can't leak. */
  .styles-view :global(.style-section) {
    display: grid;
    gap: var(--space-4);
  }
  .styles-view :global(.style-section > header) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    justify-content: space-between;
  }
  .styles-view :global(.style-section > header h2) {
    margin: 0;
    margin-right: auto;
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
  }
  .styles-view :global(.style-section .grid) {
    display: grid;
    gap: var(--space-3);
  }
  .styles-view :global(.style-section .muted) {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }
  .styles-view :global(.style-section .error) {
    margin: 0;
    border: 1px solid var(--color-state-danger);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-state-danger) 8%, transparent);
    color: var(--color-state-danger);
    padding: var(--space-3);
    font-size: var(--font-size-sm);
  }

  @media (max-width: 620px) {
    .title-row {
      align-items: stretch;
      flex-direction: column;
    }
    .search {
      width: 100%;
    }
  }
</style>
