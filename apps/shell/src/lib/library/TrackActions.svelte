<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { LibraryTrack } from '../../../shared/contract'
  import Icon from '../ui/Icon.svelte'
  import ToggleBadge from '../ui/ToggleBadge.svelte'

  interface Props {
    track: LibraryTrack
    busy: boolean
    editing: boolean
    savingRename: boolean
    movingFolder: boolean
    recipeHidden: boolean
    onstartedit: () => void
    onrate: (rating: -1 | 1) => void
    onremix: () => void
    ondetail: () => void
    onreveal: () => void
    onremove: () => void
    renameAction?: HTMLButtonElement | null
    deleteAction?: HTMLButtonElement | null
  }

  let {
    track,
    busy,
    editing,
    savingRename,
    movingFolder,
    recipeHidden,
    onstartedit,
    onrate,
    onremix,
    ondetail,
    onreveal,
    onremove,
    renameAction = $bindable<HTMLButtonElement | null>(null),
    deleteAction = $bindable<HTMLButtonElement | null>(null)
  }: Props = $props()
</script>

<div class="track-actions">
  <ToggleBadge
    pressed={track.rating === 1}
    label={`Like ${track.name}`}
    disabled={busy}
    onclick={() => onrate(1)}
    title="Like"
  >
    <Icon name="thumb-up" size={14} />
  </ToggleBadge>
  <ToggleBadge
    pressed={track.rating === -1}
    label={`Dislike ${track.name}`}
    tone="neutral"
    disabled={busy}
    onclick={() => onrate(-1)}
    title="Dislike"
  >
    <Icon name="thumb-down" size={14} />
  </ToggleBadge>
  <button
    type="button"
    class="verb"
    onclick={onstartedit}
    aria-label={`Rename ${track.name}`}
    title="Rename"
    disabled={editing || savingRename || busy}
    bind:this={renameAction}
  >
    <Icon name="edit" size={14} />
  </button>
  {#if !recipeHidden}
    <button
      type="button"
      class="verb"
      onclick={() => {
        if (!busy) onremix()
      }}
      aria-label={`Remix ${track.name}`}
      title="Remix"
      disabled={busy}
    >
      <Icon name="remix" size={14} />
    </button>
    <button
      type="button"
      class="verb"
      onclick={() => {
        if (!busy) ondetail()
      }}
      aria-label={`Show details for ${track.name}`}
      title="Details"
      disabled={busy}
    >
      <Icon name="info" size={14} />
    </button>
    <button
      type="button"
      class="verb"
      onclick={() => {
        if (!busy) onreveal()
      }}
      aria-label={`Show ${track.name} in its folder`}
      title="Show in folder"
      disabled={busy}
    >
      <Icon name="folder" size={14} />
    </button>
    <button
      bind:this={deleteAction}
      type="button"
      class="verb delete danger"
      onclick={onremove}
      aria-label={`Delete ${track.name}`}
      disabled={editing || savingRename || movingFolder || busy}
    >
      <Icon name="trash" size={13} />
      <span>Delete</span>
    </button>
  {/if}
</div>

<style>
  @import './track-actions.css';
</style>
