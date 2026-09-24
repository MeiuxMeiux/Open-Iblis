<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { tick } from 'svelte'
  import type { LibraryFolder } from '../../../shared/contract'
  import Icon from '../ui/Icon.svelte'
  import { folderDisplayName } from './folder-label'

  let {
    folder,
    count,
    active,
    onselect,
    onrename,
    onremove
  }: {
    folder: LibraryFolder
    count: number
    active: boolean
    onselect: () => void
    onrename: (name: string) => Promise<string | null>
    onremove: () => Promise<boolean>
  } = $props()

  let editing = $state(false)
  let draft = $state('')
  let saving = $state(false)
  let deleting = $state(false)
  let renameError = $state<string | null>(null)
  let input = $state<HTMLInputElement | null>(null)
  let renameAction = $state<HTMLButtonElement | null>(null)
  let deleteAction = $state<HTMLButtonElement | null>(null)
  const displayName = $derived(folderDisplayName(folder.name))

  async function startEdit(): Promise<void> {
    draft = folder.name
    renameError = null
    editing = true
    await tick()
    input?.focus()
    input?.select()
  }

  function restoreFocus(source: Element | null, force = false): void {
    void tick().then(() => {
      if (force || document.activeElement === document.body || document.activeElement === source) {
        renameAction?.focus()
      }
    })
  }

  async function commit(restore = false): Promise<void> {
    if (!editing || saving) return
    const source = input
    if (!draft.trim()) {
      renameError = 'Enter a folder name.'
      if (restore) {
        await tick()
        if (document.activeElement === document.body || document.activeElement === source) {
          input?.focus()
        }
      }
      return
    }
    if (draft.trim() === folder.name) {
      editing = false
      renameError = null
      if (restore) restoreFocus(source)
      return
    }
    saving = true
    const failure = await onrename(draft)
    saving = false
    if (failure) {
      renameError = failure
      if (restore) {
        await tick()
        if (document.activeElement === document.body || document.activeElement === source) {
          input?.focus()
        }
      }
      return
    }
    editing = false
    renameError = null
    if (restore) restoreFocus(source)
  }

  function cancel(): void {
    const source = input
    editing = false
    renameError = null
    restoreFocus(source, true)
  }

  async function remove(): Promise<void> {
    if (deleting) return
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

  function onkeydown(event: KeyboardEvent): void {
    if (saving && (event.key === 'Enter' || event.key === 'Escape')) {
      event.preventDefault()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }
</script>

<div class="folder-row" class:active class:editing>
  {#if editing}
    <input
      bind:this={input}
      bind:value={draft}
      aria-label={`Rename folder ${displayName}`}
      maxlength="80"
      readonly={saving}
      aria-busy={saving}
      aria-invalid={!!renameError}
      aria-describedby={renameError ? `folder-error-${folder.id}` : undefined}
      onblur={() => void commit(false)}
      {onkeydown}
    />
  {:else}
    <button
      type="button"
      class="folder-name"
      class:current={active}
      aria-current={active ? 'page' : undefined}
      onclick={onselect}
    >
      <Icon name="folder" size={14} />
      <span>{displayName}</span>
      <span class="count" aria-label={`${count} tracks`}>{count}</span>
    </button>
  {/if}

  {#if renameError}
    <p id={`folder-error-${folder.id}`} class="rename-error" role="alert">{renameError}</p>
  {/if}

  <div class="folder-actions">
    <button
      bind:this={renameAction}
      type="button"
      aria-label={`Rename folder ${displayName}`}
      title="Rename folder"
      disabled={editing || saving || deleting}
      onclick={() => void startEdit()}
    >
      <Icon name="edit" size={12} />
    </button>
    <button
      bind:this={deleteAction}
      type="button"
      class="danger"
      aria-label={`Delete folder ${displayName}; tracks move to No folder`}
      title="Delete folder; tracks move to No folder"
      disabled={editing || saving || deleting}
      onclick={() => void remove()}
    >
      <Icon name="trash" size={12} />
      <span>Delete</span>
    </button>
  </div>
</div>

<style>
  @import './folder-row.css';
</style>
