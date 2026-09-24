<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    pressed: boolean
    label: string
    title?: string
    disabled?: boolean
    tone?: 'accent' | 'neutral'
    children: Snippet
    onclick?: (event: MouseEvent) => void
  }

  let {
    pressed,
    label,
    title,
    disabled = false,
    tone = 'accent',
    children,
    onclick
  }: Props = $props()
</script>

<button
  type="button"
  class="toggle"
  class:neutral={tone === 'neutral'}
  aria-pressed={pressed}
  aria-label={label}
  title={title ?? label}
  {disabled}
  {onclick}
>
  {@render children()}
</button>

<style>
  .toggle {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    min-width: calc(var(--space-6) - var(--space-1));
    height: calc(var(--space-6) - var(--space-1));
    padding: var(--space-0) var(--space-1);
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    line-height: 1;
    transition:
      color var(--motion-duration-fast) var(--motion-ease-standard),
      background var(--motion-duration-fast) var(--motion-ease-standard),
      border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .toggle:hover:not(:disabled) {
    color: var(--color-text-primary);
    background: var(--app-surface-hover);
  }
  .toggle:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .toggle[aria-pressed='true'] {
    color: var(--color-accent);
    background: var(--color-bg-subtle);
    border-color: var(--color-border-default);
  }
  .toggle.neutral[aria-pressed='true'] {
    color: var(--color-text-primary);
  }
  .toggle:disabled {
    cursor: default;
    opacity: 0.5;
  }
</style>
