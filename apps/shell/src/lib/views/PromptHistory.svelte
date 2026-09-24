<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { LibraryPrompt } from '../../../shared/contract'
  import Icon from '../ui/Icon.svelte'
  import ToggleBadge from '../ui/ToggleBadge.svelte'

  // Prompt-history recall for the Create view: a toggle button + dropdown
  // panel. Starred prompts pin to the top and survive "Clear history";
  // per-entry delete and clear-all only touch history rows, never tracks.
  let { onpick }: { onpick: (text: string) => void } = $props()

  let open = $state(false)
  let prompts = $state<LibraryPrompt[]>([])
  let error = $state<string | null>(null)

  async function refresh(): Promise<void> {
    const r = await window.iblis.library.prompts()
    if (r.ok) {
      prompts = r.data
      error = null
    } else {
      error = r.error
    }
  }

  async function toggle(): Promise<void> {
    open = !open
    if (open) await refresh()
  }

  function pick(p: LibraryPrompt): void {
    onpick(p.text)
    open = false
  }

  async function star(p: LibraryPrompt): Promise<void> {
    const r = await window.iblis.library.promptStar(p.id, !p.starred)
    if (r.ok) await refresh()
  }

  async function remove(p: LibraryPrompt): Promise<void> {
    const r = await window.iblis.library.promptRemove(p.id)
    if (r.ok) await refresh()
  }

  async function clearAll(): Promise<void> {
    const r = await window.iblis.library.promptsClear()
    if (r.ok) await refresh()
  }

  const hasUnstarred = $derived(prompts.some((p) => !p.starred))
</script>

<div class="history">
  <button class="toggle" onclick={() => void toggle()} aria-expanded={open}>
    <Icon name="history" size={14} />
    <span>History</span>
  </button>

  {#if open}
    <div class="panel">
      {#if error}
        <p class="note">{error}</p>
      {:else if prompts.length === 0}
        <p class="note">No prompts yet — every generation you start lands here.</p>
      {:else}
        <ul>
          {#each prompts as p (p.id)}
            <li>
              <ToggleBadge
                pressed={p.starred}
                label="Star prompt"
                onclick={() => void star(p)}
                title={p.starred ? 'Unstar (clearable again)' : 'Star (survives Clear history)'}
              >
                <Icon name={p.starred ? 'star-filled' : 'star'} size={13} />
              </ToggleBadge>
              <button class="text" onclick={() => pick(p)} title={p.text}>
                {p.text}
              </button>
              <span class="uses" title="Times used">{p.useCount > 1 ? `x${p.useCount}` : ''}</span>
              <button
                class="del"
                onclick={() => void remove(p)}
                title="Delete from history"
                aria-label="Delete prompt"
              >
                <Icon name="trash" size={13} />
              </button>
            </li>
          {/each}
        </ul>
        {#if hasUnstarred}
          <button class="clear" onclick={() => void clearAll()}>
            <Icon name="trash" size={14} />
            <span>Clear history (keeps starred)</span>
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .history {
    position: relative;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    border-radius: var(--radius-lg);
    padding: 2px 10px;
    font-size: 11.5px;
  }
  .toggle:hover,
  .toggle[aria-expanded='true'] {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 10;
    width: 420px;
    max-width: 70vw;
    max-height: 300px;
    overflow-y: auto;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: 6px;
  }
  .note {
    margin: 0;
    padding: 10px;
    font-size: 12.5px;
    color: var(--color-text-secondary);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--radius-lg);
    padding: 2px 4px;
  }
  li:hover {
    background: var(--app-surface-hover);
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    color: var(--color-text-primary);
    font-size: 12.5px;
    padding: 6px 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .uses {
    flex: none;
    font-size: 11px;
    color: var(--color-text-secondary);
  }
  .del {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    background: none;
    border: none;
    border-radius: var(--radius-lg);
    color: var(--color-text-secondary);
  }
  .del:hover {
    color: var(--color-text-primary);
    background: var(--app-surface-hover);
  }
  .clear {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 4px;
    border: none;
    border-top: 1px solid var(--color-border-default);
    background: none;
    color: var(--color-text-secondary);
    font-size: 12px;
    padding: 8px;
  }
  .clear:hover {
    color: var(--color-text-primary);
  }
</style>
