<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // The searchable grid of SkinContract tokens inside <SkinEditor>. Display
  // only: it renders a colour/text control per token and reports edits up via
  // callbacks; the parent owns the override map and persistence.
  import { type SkinToken } from '@iblis/plugin-sdk'
  import Icon from '../ui/Icon.svelte'
  import { filterGroups, tokenKind, type SkinOverrides } from './editor'

  let {
    overrides,
    values,
    onEdit,
    onReset
  }: {
    overrides: SkinOverrides
    values: Record<string, string>
    onEdit: (token: SkinToken, value: string) => void
    onReset: (token: SkinToken) => void
  } = $props()

  let query = $state('')
  const groups = $derived(filterGroups(query))

  // <input type="color"> needs a 6-digit hex; fall back when the token value
  // isn't one (e.g. a named colour or rgba override).
  const asHex = (v: string): string => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : '#000000')
</script>

<div class="editor">
  <input
    class="search"
    type="search"
    placeholder="Filter tokens…"
    bind:value={query}
    aria-label="Filter tokens"
  />

  {#each groups as g (g.ns)}
    <h3 class="ns">{g.label}</h3>
    <div class="tokens">
      {#each g.tokens as token (token)}
        <div class="row" class:edited={token in overrides}>
          <code class="tname">{token}</code>
          <div class="control">
            {#if tokenKind(token) === 'color'}
              <input
                type="color"
                value={asHex(values[token] ?? '')}
                aria-label={token}
                oninput={(e) => onEdit(token, e.currentTarget.value)}
              />
            {/if}
            <input
              class="text"
              type="text"
              value={values[token] ?? ''}
              aria-label={`${token} value`}
              onchange={(e) => onEdit(token, e.currentTarget.value)}
            />
            <button
              type="button"
              class="revert"
              title="Reset to skin default"
              disabled={!(token in overrides)}
              onclick={() => onReset(token)}
            >
              <Icon name="refresh" size={13} />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/each}
  {#if groups.length === 0}
    <p class="hint">No tokens match “{query}”.</p>
  {/if}
</div>

<style>
  .editor {
    margin-top: 14px;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--color-text-primary);
    background: var(--color-bg-inset);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
  }
  .ns {
    margin: 16px 0 6px;
    font-size: 11px;
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
  .hint {
    margin: 6px 0 16px;
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .tokens {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    border-left: 2px solid transparent;
  }
  .row.edited {
    border-left-color: var(--color-accent);
    background: var(--color-bg-subtle);
  }
  .tname {
    font-family: var(--font-family-mono);
    font-size: 12px;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .control {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .control input[type='color'] {
    width: 28px;
    height: 26px;
    padding: 0;
    background: none;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .text {
    width: 150px;
    padding: 4px 8px;
    font-family: var(--font-family-mono);
    font-size: 12px;
    color: var(--color-text-primary);
    background: var(--color-bg-inset);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
  }
  .revert {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--color-text-secondary);
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .revert:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .revert:not(:disabled):hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
  }
</style>
