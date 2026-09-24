<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { StyleIndexEntryView, StylesDownloadProgress } from '../../../shared/styles'
  import Badge from '../ui/Badge.svelte'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import RequiresKey from '../ui/RequiresKey.svelte'
  import { licensing } from '../licensing.svelte'
  import StyleCard from './StyleCard.svelte'
  import {
    matchesCategory,
    matchesOrigin,
    matchesQuery,
    megabytes,
    type StyleFilters,
    type StyleOriginChip
  } from './filters'

  let {
    filters,
    libraryStamp = 0,
    onLibraryChanged
  }: {
    filters: StyleFilters
    libraryStamp?: number
    onLibraryChanged?: () => void
  } = $props()

  let entries = $state<StyleIndexEntryView[]>([])
  let loaded = $state(false)
  let unreachable = $state(false)
  let error = $state('')
  let busy = $state<string | null>(null)
  let progress = $state<StylesDownloadProgress | null>(null)

  onMount(() => window.iblis.styles.onDownloadProgress((next) => (progress = next)))

  const locked = $derived(licensing.locked('styles-community'))

  async function load(force = false): Promise<void> {
    // Skip the doomed IPC while locked — the gate panel covers the body, and
    // the main-process check would refuse this anyway.
    if (licensing.locked('styles-community')) {
      loaded = true
      return
    }
    try {
      const result = await window.iblis.styles.index(force)
      if (!result.ok) return void (unreachable = true)
      unreachable = false
      // Most recent first, simple.
      entries = [...result.data.entries].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      )
    } catch {
      unreachable = true
    } finally {
      loaded = true
    }
  }

  $effect(() => {
    void libraryStamp
    // Re-run when the lock flips (key entered / revoked) so browsing recovers
    // or locks live without a manual refresh.
    void locked
    void load()
  })

  function origins(entry: StyleIndexEntryView): StyleOriginChip[] {
    return entry.yours ? ['trained', 'community'] : ['community']
  }

  let visible = $derived(
    entries.filter(
      (entry) =>
        matchesQuery(filters, [entry.name, ...entry.tags, ...entry.categories]) &&
        matchesCategory(filters, entry.categories) &&
        matchesOrigin(filters, origins(entry))
    )
  )

  function percent(id: string): number | null {
    return progress?.id === id ? progress.percent : null
  }

  async function download(entry: StyleIndexEntryView): Promise<void> {
    busy = entry.id
    progress = null
    error = ''
    const result = await window.iblis.styles.download(entry.id)
    busy = null
    progress = null
    if (!result.ok) return void (error = result.error)
    onLibraryChanged?.()
  }

  async function remove(entry: StyleIndexEntryView): Promise<void> {
    const adapterId = entry.installedAdapterId
    if (!adapterId) return
    busy = entry.id
    error = ''
    const result = await window.iblis.styles.remove(adapterId)
    busy = null
    if (!result.ok) return void (error = result.error)
    onLibraryChanged?.()
  }
</script>

<section class="style-section" aria-labelledby="community-trainings-heading">
  <header>
    <h2 id="community-trainings-heading">Community trainings</h2>
    {#if !locked}
      <Button size="sm" icon="refresh" disabled={busy !== null} onclick={() => void load(true)}>
        Refresh
      </Button>
    {/if}
  </header>
  <RequiresKey
    feature="styles-community"
    title="A product key unlocks community styles"
    body="Enter your key to browse and download styles the community trained. Your imported and already-downloaded styles keep working."
  >
    {#if unreachable}
      <p class="muted">
        The community library is unreachable. Downloaded and imported styles keep working.
      </p>
    {:else if !loaded}
      <p class="muted">Loading community trainings…</p>
    {:else if entries.length === 0}
      <p class="muted">Nothing here yet. Train something and it will appear for everyone.</p>
    {:else if visible.length === 0}
      <p class="muted">No community trainings match — clear filters.</p>
    {:else}
      <div class="grid" aria-label="Community trainings">
        {#each visible as entry (entry.id)}
          <StyleCard title={entry.name} busy={busy === entry.id}>
            {#snippet badges()}
              {#if entry.yours}<Badge tone="accent" variant="outline">Yours</Badge>{/if}
              {#each entry.categories as category (category)}
                <Badge>{category === 'texture' ? 'Texture' : 'Groove'}</Badge>
              {/each}
            {/snippet}
            {#snippet body()}
              {#if entry.tags.length > 0}
                <div class="tags" aria-label="Training tags">
                  {#each entry.tags as tag (tag)}<Badge>{tag}</Badge>{/each}
                </div>
              {/if}
              <div class="meta">
                <span>{megabytes(entry.bytes)}</span>
                <span
                  >{entry.downloadCount}
                  {entry.downloadCount === 1 ? 'download' : 'downloads'}</span
                >
                <span>Updated {entry.updatedAt.slice(0, 10)}</span>
              </div>
            {/snippet}
            {#snippet footer()}
              {#if entry.installedAdapterId}
                <Badge tone="success" variant="outline">
                  <Icon name="check" size={13} /> Downloaded
                </Badge>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy !== null}
                  onclick={() => void remove(entry)}>Remove</Button
                >
              {:else}
                <Button
                  variant="primary"
                  icon="download"
                  disabled={busy !== null}
                  onclick={() => void download(entry)}
                >
                  {#if busy === entry.id}
                    {percent(entry.id) === null ? 'Starting' : `Downloading ${percent(entry.id)}%`}
                  {:else}
                    Download
                  {/if}
                </Button>
              {/if}
            {/snippet}
          </StyleCard>
        {/each}
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </RequiresKey>
</section>

<style>
  .tags,
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .meta {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  .meta span + span::before {
    content: '·';
    margin-right: var(--space-2);
    color: var(--color-text-muted);
  }
</style>
