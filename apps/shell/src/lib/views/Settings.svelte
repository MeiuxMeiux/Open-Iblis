<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Settings hub: the product key stays pinned on top; every other area is a
  // card that opens on demand, so loading Settings shows a map instead of one
  // long scroll. New settings areas get a new card here — that is the pattern
  // going forward. A card for a hosted service may declare requiresKey with the
  // service feature it needs; it then renders dimmed with a key notice while
  // that feature is locked. Local areas never do: the local app is free (D-O2).
  import type { ServiceFeature } from '../../../shared/licensing'
  import type { IconName } from '../ui/icons'
  import Icon from '../ui/Icon.svelte'
  import { licensing } from '../licensing.svelte'
  import { nav } from '../navigation.svelte'
  import AppearancePanel from './AppearancePanel.svelte'
  import EngineActionsProbe from './EngineActionsProbe.svelte'
  import PerfPanel from './PerfPanel.svelte'
  import EnginePicker from './EnginePicker.svelte'
  import DiagnosticsPanel from './DiagnosticsPanel.svelte'
  import FeedbackPanel from './FeedbackPanel.svelte'
  import LicensePanel from './LicensePanel.svelte'
  import UpdatePanel from './UpdatePanel.svelte'
  import ProcessorSettingsPanel from './ProcessorSettingsPanel.svelte'
  import CloudProvidersPanel from './CloudProvidersPanel.svelte'
  import StoragePanel from './StoragePanel.svelte'

  type SectionId =
    | 'appearance'
    | 'engine'
    | 'analysis'
    | 'cloud'
    | 'storage'
    | 'diagnostics'
    | 'feedback'
    | 'updates'

  interface SectionCard {
    id: SectionId
    icon: IconName
    title: string
    detail: string
    requiresKey?: ServiceFeature
  }

  const SECTIONS: SectionCard[] = [
    {
      id: 'appearance',
      icon: 'skin',
      title: 'Appearance',
      detail: 'Skins, per-token edits, export and import'
    },
    {
      id: 'engine',
      icon: 'flame',
      title: 'Engine',
      detail: 'Default engine, performance, restart, and health'
    },
    {
      id: 'analysis',
      icon: 'waveform',
      title: 'Audio analysis',
      detail: 'BPM and key providers, defaults, comparisons'
    },
    {
      id: 'cloud',
      icon: 'cube',
      title: 'Cloud providers',
      detail: 'Your own keys for song ideas and cover art'
    },
    {
      id: 'storage',
      icon: 'folder',
      title: 'Data location',
      detail: 'Where plugins, tracks, and styles live on disk'
    },
    {
      id: 'diagnostics',
      icon: 'shield',
      title: 'Diagnostics',
      detail: 'Opt-in logs and support bundles'
    },
    {
      id: 'feedback',
      icon: 'mail',
      title: 'Feedback',
      detail: 'Report a bug, request a feature, or ask a question'
    },
    {
      id: 'updates',
      icon: 'refresh',
      title: 'Updates',
      detail: 'Current version and update checks'
    }
  ]

  // The view stays mounted across tab switches, so the open section survives
  // leaving and returning to Settings without any persistence.
  let open = $state<SectionId | null>(null)

  // A product-key deep-link must land on the hub, where the key panel lives —
  // even when the user last left Settings inside a section.
  $effect(() => {
    if (nav.peekAnchor('product-key')) open = null
  })

  const openCard = $derived(SECTIONS.find((section) => section.id === open) ?? null)

  function locked(section: SectionCard): boolean {
    return section.requiresKey !== undefined && licensing.locked(section.requiresKey)
  }
</script>

<section class="settings">
  <header class="bar">
    <h1>Settings</h1>
    {#if openCard}
      <nav class="crumb" aria-label="Settings section">
        <button type="button" class="back" onclick={() => (open = null)}>
          <Icon name="chevron-left" size={14} />
          All settings
        </button>
        <span class="here">{openCard.title}</span>
      </nav>
    {/if}
  </header>

  {#if open === null}
    <LicensePanel />

    <div class="spacer"></div>
    <div class="cards">
      {#each SECTIONS as section (section.id)}
        <button
          type="button"
          class="card"
          class:locked={locked(section)}
          onclick={() => (open = section.id)}
        >
          <span class="badge" aria-hidden="true"><Icon name={section.icon} size={20} /></span>
          <span class="text">
            <span class="title">{section.title}</span>
            <span class="detail">
              {locked(section) ? 'Requires a product key' : section.detail}
            </span>
          </span>
          <span class="go" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
        </button>
      {/each}
    </div>
  {:else if open === 'appearance'}
    <AppearancePanel />
  {:else if open === 'engine'}
    <div class="engine-default">
      <EnginePicker heading="Default engine for Create" />
    </div>
    <PerfPanel />
    <EngineActionsProbe />
  {:else if open === 'analysis'}
    <ProcessorSettingsPanel />
  {:else if open === 'cloud'}
    <CloudProvidersPanel />
  {:else if open === 'storage'}
    <StoragePanel />
  {:else if open === 'diagnostics'}
    <DiagnosticsPanel />
  {:else if open === 'feedback'}
    <FeedbackPanel />
  {:else if open === 'updates'}
    <UpdatePanel />
  {/if}
</section>

<style>
  .engine-default {
    margin-bottom: 18px;
  }
  .settings {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 32px;
  }
  .bar {
    display: flex;
    align-items: baseline;
    gap: 16px;
    margin-bottom: 18px;
  }
  .spacer {
    height: 24px;
  }
  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: var(--font-weight-semibold);
  }

  .crumb {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px 4px 6px;
    font-size: 12.5px;
    color: var(--color-text-secondary);
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
  }
  .back:hover {
    background: var(--app-surface-hover);
    color: var(--color-text-primary);
  }
  .here {
    color: var(--color-text-secondary);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--space-3);
  }
  .card {
    display: flex;
    align-items: center;
    gap: 14px;
    text-align: left;
    padding: 14px 16px;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    transition:
      border-color var(--motion-duration-fast) ease,
      background var(--motion-duration-fast) ease;
  }
  .card:hover {
    background: var(--app-surface-hover);
    border-color: var(--color-accent);
  }
  .card.locked {
    opacity: 0.55;
  }

  .badge {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 38px;
    height: 38px;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    border-radius: var(--radius-md);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .title {
    font-size: 14px;
    color: var(--color-text-primary);
  }
  .detail {
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }
  .go {
    margin-left: auto;
    color: var(--color-text-muted);
  }
</style>
