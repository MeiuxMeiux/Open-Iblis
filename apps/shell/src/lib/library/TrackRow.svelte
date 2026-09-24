<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { tick } from 'svelte'
  import type { LibraryFolder, LibraryTrack } from '../../../shared/contract'
  import type { LibraryDisplayPreferences } from '../display-preferences'
  import Badge from '../ui/Badge.svelte'
  import Icon from '../ui/Icon.svelte'
  import { queue } from '../queue.svelte'
  import { comparisonForTrack } from '../queue/comparison-visibility'
  import { folderDisplayName } from './folder-label'
  import { detectedBadges, targetMusicalMetadata } from './track-metadata'
  import TrackActions from './TrackActions.svelte'

  let {
    track,
    display,
    removing,
    active,
    playing,
    onplay,
    onremix,
    ondetail,
    onrename,
    onrate,
    onremove,
    onreveal,
    ondragout,
    folders,
    onmove
  }: {
    track: LibraryTrack
    display: LibraryDisplayPreferences
    removing: boolean
    active: boolean
    playing: boolean
    onplay: () => void
    onremix: () => void
    ondetail: () => void
    onrename: (name: string) => Promise<string | null>
    onrate: (rating: -1 | 1) => void
    onremove: () => Promise<boolean>
    onreveal: () => void
    ondragout: () => void
    folders: LibraryFolder[]
    onmove: (folderId?: string) => Promise<boolean>
  } = $props()

  let editing = $state(false)
  let draft = $state('')
  let savingRename = $state(false)
  let renameError = $state<string | null>(null)
  let deleting = $state(false)
  let movingFolder = $state(false)
  let renameInput = $state<HTMLInputElement | null>(null)
  let renameAction = $state<HTMLButtonElement | null>(null)
  let deleteAction = $state<HTMLButtonElement | null>(null)
  const busy = $derived(removing || deleting)

  function startEdit(): void {
    if (busy) return
    draft = track.name
    renameError = null
    editing = true
  }
  function restoreRenameFocus(source: Element | null, force = false): void {
    void tick().then(() => {
      if (force || document.activeElement === document.body || document.activeElement === source) {
        renameAction?.focus()
      }
    })
  }
  async function commit(restoreFocus = false): Promise<void> {
    if (!editing || savingRename || busy) return
    const source = renameInput
    if (!draft.trim()) {
      renameError = 'Enter a track name.'
      if (restoreFocus) {
        await tick()
        if (document.activeElement === document.body || document.activeElement === source) {
          renameInput?.focus()
        }
      }
      return
    }
    if (draft.trim() === track.name) {
      editing = false
      renameError = null
      if (restoreFocus) restoreRenameFocus(source)
      return
    }
    savingRename = true
    const failure = await onrename(draft)
    savingRename = false
    if (failure) {
      renameError = failure
      if (restoreFocus) {
        await tick()
        if (document.activeElement === document.body || document.activeElement === source) {
          renameInput?.focus()
        }
      }
      return
    }
    editing = false
    renameError = null
    if (restoreFocus) restoreRenameFocus(source)
  }
  function onkeydown(e: KeyboardEvent): void {
    if (savingRename && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit(true)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      const source = renameInput
      editing = false
      renameError = null
      restoreRenameFocus(source, true)
    }
  }

  async function remove(): Promise<void> {
    if (busy) return
    const startedFocused = document.activeElement === deleteAction
    deleting = true
    let removed: boolean
    try {
      removed = await onremove()
    } finally {
      deleting = false
    }
    await tick()
    if (
      !removed &&
      startedFocused &&
      (document.activeElement === document.body || document.activeElement === deleteAction)
    ) {
      deleteAction?.focus()
    }
  }

  async function moveFolder(select: HTMLSelectElement): Promise<void> {
    if (movingFolder || busy) return
    const startedFocused = document.activeElement === select
    movingFolder = true
    const folderId = select.value || undefined
    let moved: boolean
    try {
      moved = await onmove(folderId)
    } finally {
      movingFolder = false
    }
    await tick()
    if (!select.isConnected) return
    if (!moved) select.value = track.folderId ?? ''
    if (
      startedFocused &&
      (document.activeElement === document.body || document.activeElement === select)
    ) {
      select.focus()
    }
  }

  function fmtDuration(sec?: number): string {
    if (sec === undefined) return '–:––'
    const s = Math.round(sec)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  const created = $derived(new Date(track.createdAt).toLocaleDateString())
  const comparison = $derived(comparisonForTrack(track, queue.entries))
  const recipeHidden = $derived(!queue.loaded || (!!comparison && !comparison.revealed))
  const target = $derived(targetMusicalMetadata(track))
  const badges = $derived(detectedBadges(track))
</script>

<div
  class="row"
  class:active
  draggable={!busy}
  role="listitem"
  aria-busy={busy}
  ondragstart={(e) => {
    if (busy) {
      e.preventDefault()
      return
    }
    const origin = e.target
    if (origin instanceof Element && origin.closest('button, input, select, label')) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    ondragout()
  }}
>
  <button
    class="play"
    onclick={() => {
      if (!busy) onplay()
    }}
    title={playing ? 'Pause' : 'Play'}
    aria-label={playing ? `Pause ${track.name}` : `Play ${track.name}`}
    disabled={busy}
  >
    <Icon name={playing ? 'pause' : 'play'} size={15} />
  </button>

  <div class="body">
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={renameInput}
        class="rename"
        bind:value={draft}
        readonly={savingRename}
        aria-busy={savingRename}
        aria-invalid={!!renameError}
        aria-describedby={renameError ? `track-rename-error-${track.id}` : undefined}
        onblur={() => void commit(false)}
        {onkeydown}
        aria-label={`Rename ${track.name}`}
        autofocus
      />
    {:else}
      <!-- Pointer convenience only; the adjacent Rename button owns keyboard semantics. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="name" ondblclick={startEdit} title="Double-click to rename">
        {track.name}
      </span>
    {/if}
    <div class="meta">
      <span>{fmtDuration(track.durationSec)}</span>
      {#if comparison && !comparison.revealed}
        <Badge variant="outline">Candidate {comparison.blindLabel}</Badge>
      {:else if !recipeHidden}
        {#each display.showDetectedAnalysis ? badges : [] as badge (badge.title)}
          <Badge tone="accent" variant="subtle" title={badge.title}>{badge.text}</Badge>
        {/each}
        {#if display.showTargetMetadata && target.bpm}
          <span title="Generation target, not detected tempo">{target.bpm} BPM target</span>
        {/if}
        {#if display.showTargetMetadata && target.key}
          <span title="Generation target, not detected key">{target.key} target</span>
        {/if}
        {#if display.showPreset && track.preset}<span>{track.preset}</span>{/if}
        {#if display.showSeed && track.seed !== undefined}<span>seed {track.seed}</span>{/if}
      {/if}
      {#if display.showDate}<span>{created}</span>{/if}
      {#if track.tags.includes('imported')}<Badge variant="outline">imported</Badge>{/if}
      <label class="folder-picker">
        <span class="sr-only">Folder for {track.name}</span>
        <select
          value={track.folderId ?? ''}
          aria-label={`Folder for ${track.name}`}
          disabled={movingFolder || busy}
          aria-busy={movingFolder}
          onchange={(event) => void moveFolder(event.currentTarget)}
        >
          <option value="">No folder</option>
          {#each folders as folder (folder.id)}
            <option value={folder.id}>{folderDisplayName(folder.name)}</option>
          {/each}
        </select>
      </label>
    </div>
    {#if renameError}
      <p id={`track-rename-error-${track.id}`} class="rename-error" role="alert">{renameError}</p>
    {/if}
  </div>

  <TrackActions
    {track}
    {busy}
    {editing}
    {savingRename}
    {movingFolder}
    {recipeHidden}
    onstartedit={startEdit}
    {onrate}
    {onremix}
    {ondetail}
    {onreveal}
    onremove={() => void remove()}
    bind:renameAction
    bind:deleteAction
  />
</div>

<style>
  @import './track-row.css';
</style>
