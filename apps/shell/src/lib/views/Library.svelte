<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import Sigil from '../Sigil.svelte'
  import FolderSidebar from '../library/FolderSidebar.svelte'
  import LibraryViewOptions from '../library/LibraryViewOptions.svelte'
  import TrackRow from '../library/TrackRow.svelte'
  import TrackDetailModal from '../library/TrackDetailModal.svelte'
  import Icon from '../ui/Icon.svelte'
  import type { GenerateRequest } from '@iblis/plugin-sdk'
  import { library, type FolderFilter } from '../library.svelte'
  import { queue } from '../queue.svelte'
  import { player } from '../player.svelte'
  import { folderDisplayName } from '../library/folder-label'
  import { matchesTrackQuery } from '../library/track-search'
  import { sortTracks } from '../library/track-sort'
  import {
    readDisplayPreferences,
    writeLibraryDisplayPreferences,
    type LibraryDisplayPreferences
  } from '../display-preferences'

  let { onremix }: { onremix: () => void } = $props()
  let detailId = $state<string | null>(null)
  let filingStatus = $state('')
  let trackHeading = $state<HTMLHeadingElement | null>(null)
  let refreshedDoneAt = 0
  let remixRequest = 0
  let display = $state<LibraryDisplayPreferences>(readDisplayPreferences().library)
  let trackQuery = $state('')

  onDestroy(() => {
    remixRequest++
  })

  const visibleTracks = $derived.by(() => {
    const filter = library.folderFilter
    const inFolder =
      filter.kind === 'all'
        ? library.tracks
        : filter.kind === 'none'
          ? library.tracks.filter((track) => !track.folderId)
          : library.tracks.filter((track) => track.folderId === filter.id)
    return sortTracks(
      inFolder.filter((track) => matchesTrackQuery(track, trackQuery)),
      display.sortOrder
    )
  })
  const filterName = $derived.by(() => {
    const filter = library.folderFilter
    if (filter.kind === 'all') return 'All tracks'
    if (filter.kind === 'none') return 'No folder'
    const name = library.folders.find((folder) => folder.id === filter.id)?.name
    return name ? folderDisplayName(name) : 'Folder'
  })

  $effect(() => {
    void library.refresh()
  })

  $effect(() => {
    writeLibraryDisplayPreferences({
      showTargetMetadata: display.showTargetMetadata,
      showDetectedAnalysis: display.showDetectedAnalysis,
      showPreset: display.showPreset,
      showDate: display.showDate,
      showSeed: display.showSeed,
      sortOrder: display.sortOrder
    })
  })

  $effect(() => {
    void queue.initialize()
    const latest = Math.max(
      0,
      ...queue.entries
        .filter((entry) => entry.status === 'done')
        .map((entry) => entry.finishedAt ?? 0)
    )
    if (latest > refreshedDoneAt) {
      refreshedDoneAt = latest
      void library.refresh()
    }
  })

  function fallbackRequest(id: string): GenerateRequest | null {
    const t = library.tracks.find((x) => x.id === id)
    if (!t) return null
    return {
      prompt: t.prompt,
      durationSec: Math.round(t.requestedDurationSec ?? t.durationSec ?? 30),
      preset: t.preset ?? 'fast',
      ...(t.seed !== undefined ? { seed: t.seed } : {}),
      ...(t.lyrics ? { lyrics: t.lyrics } : {}),
      ...(t.config ? { config: t.config } : {})
    }
  }

  async function remix(id: string): Promise<void> {
    const fallback = fallbackRequest(id)
    if (!fallback) return
    const request = ++remixRequest
    const result = await window.iblis.library.detail(id, false).catch(() => null)
    if (request !== remixRequest) return
    library.setRemix(result?.ok ? (result.data.generation?.request ?? fallback) : fallback)
    onremix()
  }

  function openDetail(id: string): void {
    remixRequest++
    detailId = id
  }

  function closeDetail(): void {
    remixRequest++
    detailId = null
  }

  function filterContains(folderId?: string): boolean {
    const filter = library.folderFilter
    if (filter.kind === 'all') return true
    if (filter.kind === 'none') return !folderId
    return filter.id === folderId
  }

  async function focusTrackHeading(source: Element | null): Promise<void> {
    await tick()
    if (document.activeElement === document.body || document.activeElement === source) {
      trackHeading?.focus()
    }
  }

  async function fileTrack(
    track: (typeof library.tracks)[number],
    folderId?: string
  ): Promise<boolean> {
    const source = document.activeElement
    const moved = await library.moveToFolder(track.id, folderId)
    if (!moved) return false
    const destination = folderId
      ? folderDisplayName(
          library.folders.find((folder) => folder.id === folderId)?.name ?? 'folder'
        )
      : 'No folder'
    filingStatus = `${track.name} moved to ${destination}.`
    if (!filterContains(folderId)) {
      await focusTrackHeading(source)
    }
    return true
  }

  async function removeTrack(track: (typeof library.tracks)[number]): Promise<boolean> {
    remixRequest++
    const source = document.activeElement
    const removed = await library.remove(track.id)
    if (removed) {
      filingStatus = `${track.name} deleted.`
      await focusTrackHeading(source)
    }
    return removed
  }

  async function showAllTracks(): Promise<void> {
    const source = document.activeElement
    library.selectFolder({ kind: 'all' })
    await focusTrackHeading(source)
  }
</script>

<section class="library">
  <header>
    <h1>Library</h1>
    <p class="lead">File tracks into folders, rename them, play them, or reuse their recipes.</p>
  </header>

  {#if library.error}
    <p class="error" role="alert">{library.error}</p>
  {/if}
  <p class="sr-only" aria-live="polite">{filingStatus}</p>

  <div class="organizer">
    <FolderSidebar
      folders={library.folders}
      tracks={library.tracks}
      filter={library.folderFilter}
      onselect={(filter: FolderFilter) => library.selectFolder(filter)}
      oncreate={(name: string) => library.createFolder(name)}
      onrename={(id: string, name: string) => library.renameFolder(id, name)}
      onremove={(id: string) => library.removeFolder(id)}
    />

    <section class="track-pane" aria-labelledby="track-filter-title">
      <div class="track-heading">
        <div class="track-heading-copy">
          <h2 id="track-filter-title" tabindex="-1" bind:this={trackHeading}>{filterName}</h2>
          {#if library.loaded && library.tracks.length > 0}
            <p class="track-count">{visibleTracks.length} shown</p>
          {/if}
        </div>
        <div class="track-tools">
          <label class="search">
            <Icon name="search" size={16} />
            <span class="sr-only">Search tracks</span>
            <input type="search" placeholder="Search tracks" bind:value={trackQuery} />
          </label>
          <LibraryViewOptions
            bind:showTargetMetadata={display.showTargetMetadata}
            bind:showDetectedAnalysis={display.showDetectedAnalysis}
            bind:showPreset={display.showPreset}
            bind:showDate={display.showDate}
            bind:showSeed={display.showSeed}
            bind:sortOrder={display.sortOrder}
          />
        </div>
      </div>
      {#if !library.loaded}
        <p class="muted">Loading library…</p>
      {:else if library.tracks.length === 0}
        <div class="empty">
          <div class="sigil" aria-hidden="true"><Sigil size={44} /></div>
          <p class="muted">
            Nothing here yet. Generate a track in Create and it will land in the library, named and
            playable.
          </p>
        </div>
      {:else if visibleTracks.length === 0}
        <div class="empty compact">
          <p class="muted">
            {trackQuery.trim()
              ? `No tracks in ${filterName.toLowerCase()} match “${trackQuery.trim()}”.`
              : 'No tracks are filed here yet. Choose this folder on any track row.'}
          </p>
          {#if trackQuery.trim()}
            <button type="button" onclick={() => (trackQuery = '')}> Clear search </button>
          {:else}
            <button type="button" onclick={() => void showAllTracks()}> View all tracks </button>
          {/if}
        </div>
      {:else}
        <div class="rows" role="list">
          {#each visibleTracks as track (track.id)}
            <TrackRow
              {track}
              {display}
              folders={library.folders}
              removing={library.isRemoving(track.id)}
              active={player.activeId === track.id}
              playing={player.activeId === track.id && player.playIntent}
              onplay={() => player.toggle(track)}
              onremix={() => void remix(track.id)}
              ondetail={() => openDetail(track.id)}
              onrename={(name: string) => library.rename(track.id, name)}
              onrate={(r: -1 | 1) => void library.rate(track.id, r)}
              onmove={(folderId?: string) => fileTrack(track, folderId)}
              onremove={() => removeTrack(track)}
              onreveal={() => void library.reveal(track.id)}
              ondragout={() => library.dragOut(track.id)}
            />
          {/each}
        </div>
      {/if}
    </section>
  </div>
</section>

{#if detailId}
  {#key detailId}
    <TrackDetailModal
      id={detailId}
      onclose={closeDetail}
      onremix={() => {
        if (detailId) void remix(detailId)
      }}
    />
  {/key}
{/if}

<style>
  @import '../library/library-view.css';
</style>
