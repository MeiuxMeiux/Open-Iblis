<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type {
    AdapterInstallProgress,
    AdapterImportDetails,
    AdapterOffer,
    ImportedAdapterRecord
  } from '../../../shared/adapters'
  import Badge from '../ui/Badge.svelte'
  import Button from '../ui/Button.svelte'
  import StyleDisclosureDialog from './StyleDisclosureDialog.svelte'
  import StyleOfferCard from './StyleOfferCard.svelte'
  import { matchesCategory, matchesOrigin, matchesQuery, type StyleFilters } from './filters'

  let {
    filters,
    libraryStamp = 0,
    onLibraryChanged
  }: {
    filters: StyleFilters
    libraryStamp?: number
    onLibraryChanged?: () => void
  } = $props()

  let offers = $state<AdapterOffer[]>([])
  let adapters = $state<ImportedAdapterRecord[]>([])
  let loading = $state(true)
  let error = $state('')
  let busy = $state<string | null>(null)
  let progress = $state<AdapterInstallProgress | null>(null)
  let acknowledgements = $state<Record<string, boolean>>({})
  let pending = $state<AdapterOffer | null>(null)
  const installedListError = 'Installed styles could not be read. Reload styles.'

  onMount(() => window.iblis.adapters.onInstallProgress((next) => (progress = next)))

  function timeLimit<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const limit = new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Timed out')), milliseconds)
    })
    return Promise.race([work, limit]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout)
    })
  }

  // The curated catalog renders first and independently: a stalled installed-
  // library read only delays the "In library" markers, never the offers.
  async function refresh(): Promise<void> {
    loading = true
    error = ''
    try {
      const offerResult = await window.iblis.adapters.offers()
      if (!offerResult.ok) return void (error = offerResult.error)
      offers = [...offerResult.data].sort((left, right) => left.name.localeCompare(right.name))
    } catch {
      error = 'Styles could not be loaded. Reload styles and try again.'
    } finally {
      loading = false
    }
    try {
      const libraryResult = await timeLimit(window.iblis.adapters.list(), 5_000)
      if (!libraryResult.ok) return void (error = installedListError)
      adapters = libraryResult.data
    } catch {
      error = installedListError
    }
  }

  $effect(() => {
    void libraryStamp
    void refresh()
  })

  let visible = $derived(
    offers.filter(
      (offer) =>
        matchesQuery(filters, [offer.name, offer.maker, ...offer.tags]) &&
        matchesCategory(filters, []) &&
        matchesOrigin(filters, [offer.lane])
    )
  )

  function installed(offer: AdapterOffer): boolean {
    return adapters.some((adapter) => {
      if (adapter.sourceOfferId) return adapter.sourceOfferId === offer.id
      return adapter.sourceUrl === offer.sourceUrl
    })
  }

  function percentage(offerId: string): number | null {
    if (progress?.offerId !== offerId || progress.total <= 0) return null
    return Math.min(100, Math.round((progress.received / progress.total) * 100))
  }

  function acknowledged(offer: AdapterOffer): boolean {
    return !offer.requiresRiskAcknowledgement || acknowledgements[offer.id] === true
  }

  function offerDetails(offer: AdapterOffer): AdapterImportDetails {
    return {
      displayName: offer.name,
      sourceOfferId: offer.id,
      sourceUrl: offer.sourceUrl,
      sourceRevision: offer.sourceRevision,
      claimedLicense: offer.claimedLicense,
      terms: offer.terms,
      claimedBaseModel: offer.claimedBaseModel
    }
  }

  function requestAdd(offer: AdapterOffer): void {
    if (!acknowledged(offer)) {
      error = 'Acknowledge the community-style risks before adding this style.'
      return
    }
    pending = offer
  }

  async function confirmDisclosure(): Promise<void> {
    const offer = pending
    if (!offer) return
    pending = null
    error = ''
    busy = offer.id
    progress = null
    const result = await window.iblis.adapters.installOffer(offer.id, true)
    busy = null
    progress = null
    if (!result.ok) return void (error = result.error)
    if (result.data) onLibraryChanged?.()
  }
</script>

<section class="style-section" aria-labelledby="catalog-heading">
  <header>
    <h2 id="catalog-heading">Curated community and experimental</h2>
    <Badge>{offers.length} available</Badge>
    <Button size="sm" icon="refresh" disabled={loading} onclick={() => void refresh()}>
      Refresh styles
    </Button>
  </header>
  {#if loading && offers.length === 0}
    <p class="muted">Loading your style library…</p>
  {:else if offers.length === 0}
    <p class="muted">No styles are available right now. Reload styles and try again.</p>
  {:else if visible.length === 0}
    <p class="muted">No curated styles match — clear filters.</p>
  {:else}
    <div class="grid" aria-label="Available styles">
      {#each visible as offer (offer.id)}
        <StyleOfferCard
          {offer}
          installed={installed(offer)}
          busy={busy !== null}
          progress={percentage(offer.id)}
          acknowledged={acknowledged(offer)}
          onAcknowledge={(checked: boolean) => (acknowledgements[offer.id] = checked)}
          onAdd={() => requestAdd(offer)}
        />
      {/each}
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if pending}
    <StyleDisclosureDialog
      details={offerDetails(pending)}
      actionLabel="Add to library"
      onConfirm={() => void confirmDisclosure()}
      onClose={() => (pending = null)}
    />
  {/if}
</section>
