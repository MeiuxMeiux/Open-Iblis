<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // The in-app token editor for the active skin (Settings → Appearance →
  // "Edit current skin", per feature/skins.md). Owns the per-skin override map
  // and persistence; the searchable token grid lives in <TokenGrid>. Also
  // exports the current skin's edits as a `.iblis-skin` file and imports one.
  //
  // The parent owns which skin is active (`skinId`) and how it is applied
  // (`onChooseSkin`); import switches the base skin through that callback so
  // the picker stays in sync.
  import { tokenToCssVar, type SkinToken } from '@iblis/plugin-sdk'
  import {
    getOverrides,
    setOverride,
    setAllOverrides,
    clearOverride,
    clearSkinOverrides,
    filterGroups,
    type SkinOverrides
  } from './editor'
  import {
    buildDescriptor,
    parseSkinFile,
    serializeSkin,
    skinFileName,
    SKIN_FILE_EXT
  } from './portable'
  import TokenGrid from './TokenGrid.svelte'
  import Badge from '../ui/Badge.svelte'
  import Icon from '../ui/Icon.svelte'

  let { skinId, onChooseSkin }: { skinId: string; onChooseSkin: (id: string) => void } = $props()

  let editing = $state(false)
  let overrides = $state<SkinOverrides>({})
  let fileInput = $state<HTMLInputElement>()
  // Result of the last import — a sideload notice (always unsigned for now).
  let notice = $state<{ kind: 'warn' | 'error'; text: string } | null>(null)
  // Effective value per token (override or the active skin's default), read
  // from the live computed style. Bumped via refresh() after any change.
  let values = $state<Record<string, string>>({})

  const root = (): HTMLElement => document.documentElement
  const overrideCount = $derived(Object.keys(overrides).length)

  function readAll(): Record<string, string> {
    const cs = getComputedStyle(root())
    const out: Record<string, string> = {}
    for (const g of filterGroups('')) {
      for (const t of g.tokens) out[t] = cs.getPropertyValue(tokenToCssVar(t)).trim()
    }
    return out
  }

  function refresh(): void {
    overrides = getOverrides(skinId)
    values = readAll()
  }

  // Re-sync when the parent switches skins (picker click or import).
  $effect(() => {
    void skinId
    refresh()
  })

  function exportCurrent(): void {
    const descriptor = buildDescriptor(skinId, overrides)
    const blob = new Blob([serializeSkin(descriptor)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = skinFileName(descriptor.id)
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importFile(file: File): Promise<void> {
    notice = null
    const res = parseSkinFile(await file.text())
    if (!res.ok) {
      notice = { kind: 'error', text: res.error }
      return
    }
    const { baseSkinId, overrides: imported, descriptor, droppedTokens, baseFellBack } = res.skin
    setAllOverrides(baseSkinId, imported) // persist before the parent re-applies
    onChooseSkin(baseSkinId) // switch base skin; our $effect then refreshes
    const count = Object.keys(imported).length
    const extras = [
      baseFellBack ? `unknown base, applied to “${baseSkinId}”` : null,
      droppedTokens.length ? `${droppedTokens.length} unknown token(s) ignored` : null
    ].filter(Boolean)
    notice = {
      kind: 'warn',
      text:
        `Imported “${descriptor.name}” — ${count} token(s) onto the ${baseSkinId} skin. ` +
        `Unsigned sideload (not from the catalog).` +
        (extras.length ? ` ${extras.join('; ')}.` : '')
    }
  }

  async function onFileChange(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) await importFile(file)
    input.value = '' // allow re-importing the same file
  }

  function edit(token: SkinToken, value: string): void {
    overrides = setOverride(skinId, token, value)
    root().style.setProperty(tokenToCssVar(token), value)
    values = { ...values, [token]: value }
  }

  function reset(token: SkinToken): void {
    overrides = clearOverride(skinId, token)
    root().style.removeProperty(tokenToCssVar(token))
    values = {
      ...values,
      [token]: getComputedStyle(root()).getPropertyValue(tokenToCssVar(token)).trim()
    }
  }

  function resetAll(): void {
    clearSkinOverrides(skinId)
    for (const g of filterGroups('')) {
      for (const t of g.tokens) root().style.removeProperty(tokenToCssVar(t))
    }
    refresh()
  }
</script>

<div class="editor-bar">
  <button type="button" class="link" aria-expanded={editing} onclick={() => (editing = !editing)}>
    <Icon name="edit" size={14} />
    <span>{editing ? 'Hide editor' : 'Edit current skin'}</span>
    {#if overrideCount > 0}<Badge>{overrideCount} edited</Badge>{/if}
  </button>
  {#if editing && overrideCount > 0}
    <button type="button" class="link danger" onclick={resetAll}>
      <Icon name="refresh" size={14} />
      <span>Reset all</span>
    </button>
  {/if}
  <span class="spacer"></span>
  <button
    type="button"
    class="link"
    title="Save this skin's edits as a .iblis-skin file"
    disabled={overrideCount === 0}
    onclick={exportCurrent}
  >
    <Icon name="download" size={14} />
    <span>Export</span>
  </button>
  <button type="button" class="link" onclick={() => fileInput?.click()}>
    <Icon name="upload" size={14} />
    <span>Import</span>
  </button>
  <input
    bind:this={fileInput}
    type="file"
    accept={`${SKIN_FILE_EXT},application/json`}
    hidden
    onchange={onFileChange}
  />
</div>

{#if notice}
  <div class="notice" class:error={notice.kind === 'error'} role="status">
    <span>{notice.text}</span>
    <button
      type="button"
      class="dismiss"
      aria-label="Dismiss"
      title="Dismiss"
      onclick={() => (notice = null)}
    >
      <Icon name="close" size={13} />
    </button>
  </div>
{/if}

{#if editing}
  <TokenGrid {overrides} {values} onEdit={edit} onReset={reset} />
{/if}

<style>
  .editor-bar {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 18px;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0;
    background: none;
    border: none;
    font-size: 13px;
    font-weight: var(--font-weight-medium);
    color: var(--color-accent);
    cursor: pointer;
  }
  .link.danger {
    color: var(--color-state-danger);
  }
  .link:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .spacer {
    flex: 1;
  }

  .notice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-top: 12px;
    padding: 9px 12px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--color-text-secondary);
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border-default);
    border-left: 2px solid var(--color-state-warning);
    border-radius: var(--radius-md);
  }
  .notice.error {
    border-left-color: var(--color-state-danger);
    color: var(--color-text-primary);
  }
  .dismiss {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    margin-left: auto;
    padding: 0;
    line-height: 1;
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .dismiss:hover {
    color: var(--color-text-primary);
  }
</style>
