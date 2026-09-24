<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'
  import type { IconName } from './icons'

  /**
   * The one button in the shell. Renders an <a> when `href` is set so a link
   * that acts like a button looks like one (and still opens externally).
   * Tokens only, so every skin re-themes it for free.
   */
  interface Props {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    icon?: IconName
    href?: string
    type?: 'button' | 'submit'
    disabled?: boolean
    title?: string
    block?: boolean
    onclick?: () => void
    children: Snippet
  }

  let {
    variant = 'secondary',
    size = 'md',
    icon,
    href,
    type = 'button',
    disabled = false,
    title,
    block = false,
    onclick,
    children
  }: Props = $props()

  let iconSize = $derived(size === 'sm' ? 14 : 15)
</script>

{#if href}
  <a class="control {variant} {size}" class:block {href} {title} target="_blank" rel="noreferrer">
    {#if icon}<Icon name={icon} size={iconSize} />{/if}
    <span>{@render children()}</span>
  </a>
{:else}
  <button class="control {variant} {size}" class:block {type} {title} {disabled} {onclick}>
    {#if icon}<Icon name={icon} size={iconSize} />{/if}
    <span>{@render children()}</span>
  </button>
{/if}

<style>
  .control {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    line-height: 1;
    white-space: nowrap;
    text-decoration: none;
    transition:
      background var(--motion-duration-fast) var(--motion-ease-standard),
      border-color var(--motion-duration-fast) var(--motion-ease-standard),
      color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .md {
    min-height: 36px;
    padding: 0 var(--space-4);
  }
  .sm {
    min-height: 30px;
    padding: 0 var(--space-3);
    font-size: var(--font-size-xs);
  }
  .block {
    width: 100%;
  }
  .control:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    background: var(--app-surface-hover);
  }
  .control:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .control:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .primary {
    border-color: var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    font-weight: var(--font-weight-semibold);
  }
  .primary:hover:not(:disabled) {
    background: var(--color-accent);
    filter: brightness(1.12);
  }
  /* A disabled primary action still needs an easily readable explanation.
     Do not dim the whole control into the surrounding surface. */
  .primary:disabled {
    opacity: 1;
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-accent) 38%, var(--color-bg-subtle));
    border-color: color-mix(in srgb, var(--color-accent) 52%, var(--color-border-strong));
  }

  .ghost {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-secondary);
  }
  .ghost:hover:not(:disabled) {
    background: var(--app-surface-hover);
    color: var(--color-text-primary);
  }

  .danger:hover:not(:disabled) {
    border-color: var(--color-state-danger);
    background: color-mix(in srgb, var(--color-state-danger) 12%, transparent);
    color: var(--color-state-danger);
  }
</style>
