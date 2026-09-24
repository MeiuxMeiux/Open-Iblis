<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  interface Props {
    checked?: boolean
    label: string
    description?: string
    disabled?: boolean
    compact?: boolean
    onToggle?: (checked: boolean) => void
  }

  let {
    checked = $bindable(false),
    label,
    description,
    disabled = false,
    compact = false,
    onToggle
  }: Props = $props()

  function toggle(): void {
    checked = !checked
    onToggle?.(checked)
  }
</script>

<button
  type="button"
  class="control"
  class:compact
  role="switch"
  aria-checked={checked}
  {disabled}
  onclick={toggle}
>
  <span class="copy">
    <span class="label">{label}</span>
    {#if description}<span class="description">{description}</span>{/if}
  </span>
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>
</button>

<style>
  .control {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    text-align: left;
    color: var(--color-text-primary);
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    transition:
      background var(--motion-duration-fast) var(--motion-ease-standard),
      border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .compact {
    width: auto;
    min-height: 34px;
    padding: var(--space-1) var(--space-2);
    gap: var(--space-2);
    border-radius: var(--radius-md);
    background: transparent;
  }
  .compact .copy {
    flex-direction: row;
    align-items: center;
  }
  .compact .label {
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
  }
  .compact .track {
    width: var(--space-6);
    height: var(--space-4);
    padding: 2px;
  }
  .compact .thumb {
    width: var(--space-3);
    height: var(--space-3);
  }
  .compact[aria-checked='true'] .thumb {
    transform: translateX(var(--space-4));
  }
  .control:hover:not(:disabled) {
    background: var(--app-surface-hover);
  }
  .control:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .control:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .label {
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }
  .description {
    font-size: var(--font-size-xs);
    line-height: 1.4;
    color: var(--color-text-secondary);
  }
  .track {
    position: relative;
    flex: 0 0 auto;
    width: var(--space-8);
    height: var(--space-5);
    padding: var(--space-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-full);
    background: var(--color-bg-inset);
    transition:
      background var(--motion-duration-fast) var(--motion-ease-standard),
      border-color var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .thumb {
    display: block;
    width: var(--space-4);
    height: var(--space-4);
    border-radius: var(--radius-full);
    background: var(--color-text-secondary);
    box-shadow: var(--shadow-sm);
    transition:
      transform var(--motion-duration-fast) var(--motion-ease-standard),
      background var(--motion-duration-fast) var(--motion-ease-standard);
  }
  .control[aria-checked='true'] .track {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .control[aria-checked='true'] .thumb {
    background: var(--color-text-inverse);
    transform: translateX(var(--space-5));
  }
</style>
