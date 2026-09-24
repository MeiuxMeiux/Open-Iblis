<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import Icon from './ui/Icon.svelte'
  import type { IconName } from './ui/icons'
  import type { View } from './navigation.svelte'

  let {
    view,
    availability,
    onNavigate
  }: {
    view: View
    availability: { generate: boolean; training: boolean }
    onNavigate: (v: View) => void
  } = $props()

  const items: { id: View; label: string; icon: IconName }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'generate', label: 'Create', icon: 'waveform' },
    { id: 'library', label: 'Library', icon: 'music' },
    { id: 'styles', label: 'Styles', icon: 'grid' },
    { id: 'training', label: 'Training', icon: 'book' },
    { id: 'plugins', label: 'Plugins', icon: 'plugin' },
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ]

  const unavailable = (id: View): string | null => {
    if (id === 'generate' && !availability.generate)
      return 'Install an engine pack from Plugins first'
    if (id === 'training' && !availability.training)
      return 'Install the training pack from Plugins first'
    return null
  }
</script>

<nav class="rail" aria-label="Primary">
  {#each items as item (item.id)}
    {@const reason = unavailable(item.id)}
    <button
      class:active={view === item.id}
      aria-current={view === item.id ? 'page' : undefined}
      disabled={reason !== null}
      title={reason ?? undefined}
      onclick={() => onNavigate(item.id)}
    >
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
    </button>
  {/each}
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 0 0 132px;
    padding: 16px 10px;
    background: var(--app-surface);
    border-right: 1px solid var(--color-border-default);
  }
  button {
    display: flex;
    align-items: center;
    gap: 9px;
    text-align: left;
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    padding: 8px 12px;
    border-radius: var(--radius-lg);
    font-size: 13.5px;
    transition:
      background 0.12s ease,
      color 0.12s ease;
  }
  button:hover:not(:disabled) {
    background: var(--app-surface-hover);
    color: var(--color-text-primary);
  }
  /* The accent marks the current view on the icon only: accent text on the
     hover surface falls under 4.5:1 in the default skin. */
  button.active {
    background: var(--app-surface-hover);
    color: var(--color-text-primary);
  }
  button.active :global(.icon) {
    color: var(--color-accent);
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
</style>
