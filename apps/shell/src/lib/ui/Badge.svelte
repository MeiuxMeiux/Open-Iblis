<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
    variant?: 'subtle' | 'outline'
    caps?: boolean
    title?: string
    children: Snippet
  }

  let { tone = 'neutral', variant = 'subtle', caps = false, title, children }: Props = $props()
</script>

<span
  class="badge"
  class:accent={tone === 'accent'}
  class:success={tone === 'success'}
  class:warning={tone === 'warning'}
  class:danger={tone === 'danger'}
  class:outline={variant === 'outline'}
  class:caps
  {title}
>
  {@render children()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    padding: var(--space-0) var(--space-2);
    white-space: nowrap;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    line-height: 1.5;
    color: var(--color-text-secondary);
    background: var(--color-bg-subtle);
    border: 1px solid transparent;
    border-radius: var(--radius-full);
  }
  .badge.outline {
    background: transparent;
    border-color: var(--color-border-default);
  }
  /* Red at badge size sits just under 4.5:1 on the subtle fill; a fifth of
     the skin's text color lifts it (lighter on dark skins, darker on light). */
  .badge.accent {
    color: color-mix(in srgb, var(--color-accent) 80%, var(--color-text-primary));
  }
  .badge.success {
    color: var(--color-state-success);
  }
  .badge.warning {
    color: var(--color-state-warning);
  }
  .badge.danger {
    color: color-mix(in srgb, var(--color-state-danger) 80%, var(--color-text-primary));
  }
  .badge.accent.outline {
    border-color: var(--color-accent);
  }
  .badge.success.outline {
    border-color: var(--color-state-success);
  }
  .badge.warning.outline {
    border-color: var(--color-state-warning);
  }
  .badge.danger.outline {
    border-color: var(--color-state-danger);
  }
  .badge.caps {
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
