<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { tick } from 'svelte'
  import type { LibraryFolder, LibraryTrack } from '../../../shared/contract'
  import type { FolderFilter } from '../library.svelte'
  import Icon from '../ui/Icon.svelte'
  import FolderRow from './FolderRow.svelte'
  import { folderDisplayName } from './folder-label'

  let {
    folders,
    tracks,
    filter,
    onselect,
    oncreate,
    onrename,
    onremove
  }: {
    folders: LibraryFolder[]
    tracks: LibraryTrack[]
    filter: FolderFilter
    onselect: (filter: FolderFilter) => void
    oncreate: (name: string) => Promise<LibraryFolder | null>
    onrename: (id: string, name: string) => Promise<string | null>
    onremove: (id: string) => Promise<boolean>
  } = $props()

  let newName = $state('')
  let creating = $state(false)
  let organizerStatus = $state('')
  let newFolderInput = $state<HTMLInputElement | null>(null)
  let noFolderAction = $state<HTMLButtonElement | null>(null)

  const noFolderCount = $derived(tracks.filter((track) => !track.folderId).length)

  function count(folderId: string): number {
    return tracks.filter((track) => track.folderId === folderId).length
  }

  async function create(): Promise<void> {
    if (!newName.trim() || creating) return
    const submitted = newName
    const startingFilter = filter
    const startedFocused = document.activeElement === newFolderInput
    creating = true
    let folder: LibraryFolder | null
    try {
      folder = await oncreate(submitted)
    } finally {
      creating = false
    }
    await tick()
    if (!folder) {
      if (startedFocused && document.activeElement === document.body) newFolderInput?.focus()
      return
    }
    if (newName === submitted) newName = ''
    organizerStatus = `Folder ${folder.name} created.`
    if (filter === startingFilter) {
      onselect({ kind: 'folder', id: folder.id })
    }
  }

  async function rename(id: string, name: string): Promise<string | null> {
    const failure = await onrename(id, name)
    if (!failure) organizerStatus = `Folder renamed to ${name.trim()}.`
    return failure
  }

  async function remove(id: string): Promise<boolean> {
    const source = document.activeElement
    const rawName = folders.find((folder) => folder.id === id)?.name ?? 'Folder'
    const name = folderDisplayName(rawName)
    const removed = await onremove(id)
    if (!removed) return false
    organizerStatus = `${name} deleted. Its tracks moved to No folder.`
    await tick()
    if (document.activeElement === document.body || document.activeElement === source) {
      noFolderAction?.focus()
    }
    return true
  }
</script>

<aside aria-labelledby="folder-title">
  <a class="skip" href="#track-filter-title">Skip to tracks</a>
  <p class="sr-only" aria-live="polite">{organizerStatus}</p>
  <div class="sidebar-title">
    <h2 id="folder-title">Folders</h2>
    <span>{folders.length}</span>
  </div>

  <nav aria-label="Library folders">
    <button
      type="button"
      class="filter"
      class:current={filter.kind === 'all'}
      aria-current={filter.kind === 'all' ? 'page' : undefined}
      onclick={() => onselect({ kind: 'all' })}
    >
      <Icon name="music" size={14} />
      <span>All tracks</span>
      <span class="count" aria-label={`${tracks.length} tracks`}>{tracks.length}</span>
    </button>
    <button
      bind:this={noFolderAction}
      type="button"
      class="filter"
      class:current={filter.kind === 'none'}
      aria-current={filter.kind === 'none' ? 'page' : undefined}
      onclick={() => onselect({ kind: 'none' })}
    >
      <Icon name="folder" size={14} />
      <span>No folder</span>
      <span class="count" aria-label={`${noFolderCount} tracks`}>{noFolderCount}</span>
    </button>

    <div class="folder-list">
      {#each folders as folder (folder.id)}
        <FolderRow
          {folder}
          count={count(folder.id)}
          active={filter.kind === 'folder' && filter.id === folder.id}
          onselect={() => onselect({ kind: 'folder', id: folder.id })}
          onrename={(name: string) => rename(folder.id, name)}
          onremove={() => remove(folder.id)}
        />
      {/each}
    </div>
  </nav>

  <form
    onsubmit={(event) => {
      event.preventDefault()
      void create()
    }}
  >
    <label for="new-folder">New folder</label>
    <div>
      <input
        bind:this={newFolderInput}
        id="new-folder"
        bind:value={newName}
        maxlength="80"
        placeholder="Folder name"
        autocomplete="off"
        readonly={creating}
        aria-busy={creating}
      />
      <button type="submit" aria-disabled={!newName.trim() || creating} aria-label="Add folder">
        <Icon name="folder" size={13} />
        <span>Add</span>
      </button>
    </div>
  </form>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3);
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  .skip {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .skip:focus {
    position: static;
    width: auto;
    height: auto;
    padding: var(--space-2);
    overflow: visible;
    color: var(--color-text-primary);
    clip-path: none;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    white-space: nowrap;
    border: 0;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
  }
  .sidebar-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--color-text-secondary);
  }
  h2 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
  }
  .sidebar-title span,
  label {
    font-size: var(--font-size-xs);
  }
  nav,
  .folder-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .folder-list {
    margin-top: var(--space-1);
    padding-top: var(--space-1);
    border-top: 1px solid var(--color-border-subtle);
  }
  .filter {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
    width: 100%;
    padding: var(--space-2);
    color: var(--color-text-secondary);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
  }
  .filter:hover,
  .filter.current {
    color: var(--color-text-primary);
    background: var(--app-surface-hover);
  }
  .count {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    font-variant-numeric: tabular-nums;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: auto;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }
  form > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-1);
  }
  input,
  form button {
    min-width: 0;
    padding: var(--space-2);
    color: var(--color-text-primary);
    background: var(--color-bg-inset);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    font: inherit;
  }
  form button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    background: transparent;
  }
  form button[aria-disabled='true'] {
    opacity: 0.45;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
