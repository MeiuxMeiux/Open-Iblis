<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { AdapterOffer, ImportedAdapterRecord } from '../../../shared/adapters'
  import Badge from '../ui/Badge.svelte'
  import Button from '../ui/Button.svelte'
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

  let adapters = $state<ImportedAdapterRecord[]>([])
  let lanes = $state<Record<string, AdapterOffer['lane']>>({})
  let loaded = $state(false)
  let error = $state('')
  let busy = $state<string | null>(null)

  async function refresh(): Promise<void> {
    try {
      const result = await window.iblis.adapters.list()
      if (!result.ok) return void (error = 'Installed styles could not be read. Reload styles.')
      error = ''
      adapters = result.data
    } catch {
      error = 'Installed styles could not be read. Reload styles.'
    } finally {
      loaded = true
    }
    // Offer lanes label installed catalog styles (Community vs Experimental).
    const offers = await window.iblis.adapters.offers()
    if (offers.ok) {
      lanes = Object.fromEntries(offers.data.map((offer) => [offer.id, offer.lane]))
    }
  }

  $effect(() => {
    void libraryStamp
    void refresh()
  })

  function originLabel(record: ImportedAdapterRecord): string {
    if (record.origin === 'yours') {
      return record.visibility === 'private' ? 'Private' : 'Trained by you'
    }
    if (record.origin === 'downloaded') return 'Downloaded'
    if (record.sourceOfferId) {
      return lanes[record.sourceOfferId] === 'experimental' ? 'Experimental' : 'Community'
    }
    return 'Imported'
  }

  function origins(record: ImportedAdapterRecord): StyleOriginChip[] {
    if (record.origin === 'yours') return ['trained']
    if (record.origin === 'downloaded') return ['community']
    if (record.sourceOfferId) {
      return lanes[record.sourceOfferId] === 'experimental' ? ['experimental'] : ['community']
    }
    return []
  }

  let visible = $derived(
    adapters.filter(
      (record) =>
        matchesQuery(filters, [record.displayName, record.claimedBaseModel ?? '']) &&
        matchesCategory(filters, []) &&
        matchesOrigin(filters, origins(record))
    )
  )

  let totalBytes = $derived(adapters.reduce((sum, record) => sum + record.bytes, 0))

  async function reveal(id: string): Promise<void> {
    const result = await window.iblis.adapters.reveal(id)
    if (!result.ok) error = result.error
  }

  async function remove(id: string): Promise<void> {
    busy = id
    error = ''
    const result = await window.iblis.adapters.remove(id)
    busy = null
    if (!result.ok) return void (error = result.error)
    onLibraryChanged?.()
  }
</script>

<section class="style-section" aria-labelledby="my-library-heading">
  <header>
    <h2 id="my-library-heading">My library</h2>
    <Badge>{adapters.length} {adapters.length === 1 ? 'style' : 'styles'}</Badge>
  </header>
  {#if !loaded}
    <p class="muted">Loading your installed styles…</p>
  {:else if adapters.length === 0}
    <p class="muted">Nothing installed yet. Download or import a style above.</p>
  {:else if visible.length === 0}
    <p class="muted">No installed styles match — clear filters.</p>
  {:else}
    <div class="grid" aria-label="Installed styles">
      {#each visible as record (record.id)}
        <StyleCard
          title={record.displayName}
          subtitle={record.claimedBaseModel ?? 'Model details not supplied'}
          busy={busy === record.id}
        >
          {#snippet badges()}
            <Badge tone={record.origin === 'yours' ? 'accent' : 'neutral'} variant="outline">
              {originLabel(record)}
            </Badge>
          {/snippet}
          {#snippet footer()}
            <Badge>{megabytes(record.bytes)}</Badge>
            <Button size="sm" icon="folder" onclick={() => void reveal(record.id)}>
              Show file
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy !== null}
              onclick={() => void remove(record.id)}>Remove</Button
            >
          {/snippet}
        </StyleCard>
      {/each}
    </div>
    <p class="usage">Total on disk: {megabytes(totalBytes)}</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .usage {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
</style>
