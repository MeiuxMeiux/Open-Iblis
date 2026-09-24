<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // The one shared gate for hosted-service surfaces (community Styles today).
  // Local generation and training never render it (D-O2): the type only
  // accepts service features. When the feature is unlocked it renders its children
  // unchanged; when locked it shows an honest, non-nagging lock panel that
  // links to Settings. The lock reason comes from the live licensing state, so
  // a revocation flips this in place. See docs/admin/03-shell-integration.md.
  import type { Snippet } from 'svelte'
  import type { ServiceFeature } from '../../../shared/licensing'
  import { licensing } from '../licensing.svelte'
  import { nav } from '../navigation.svelte'
  import Icon from './Icon.svelte'

  let {
    feature,
    title,
    body,
    children
  }: {
    feature: ServiceFeature
    title: string
    body: string
    children: Snippet
  } = $props()

  const locked = $derived(licensing.locked(feature))

  // A second line that names *why* it locked when that is more honest than the
  // generic "needs a key" (revoked / expired / offline-stale), so the panel
  // never misleads someone who did have a working key.
  const reason = $derived.by((): string | null => {
    const s = licensing.state
    if (s === null) return null
    if (s.status === 'ended') {
      switch (s.reason) {
        case 'revoked':
          return 'This product key was revoked.'
        case 'expired':
          return 'This product key has expired.'
        case 'activation_cap':
          return 'This key is active on its maximum number of devices.'
        default:
          return 'This product key is no longer active.'
      }
    }
    if (s.status === 'stale')
      return 'Iblis could not revalidate this key. Reconnect, or revalidate in Settings.'
    return null
  })
</script>

{#if locked}
  <div class="requires-key" role="note">
    <span class="glyph" aria-hidden="true"><Icon name="shield" size={20} /></span>
    <div class="copy">
      <p class="title">{title}</p>
      <p class="body">{body}</p>
      {#if reason}<p class="reason">{reason}</p>{/if}
    </div>
    <button class="cta" onclick={() => nav.go('settings', 'product-key')}
      >Enter a product key</button
    >
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .requires-key {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-4);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
  }
  .glyph {
    display: inline-flex;
    color: var(--color-accent);
  }
  .copy {
    flex: 1 1 240px;
    min-width: 0;
    display: grid;
    gap: var(--space-1);
  }
  .title {
    margin: 0;
    font-weight: var(--font-weight-semibold);
    color: var(--color-text-primary);
  }
  .body,
  .reason {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  .reason {
    color: var(--color-text-muted);
  }
  .cta {
    flex: 0 0 auto;
    padding: var(--space-2) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-lg);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    font: inherit;
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
  }
  .cta:hover {
    filter: brightness(1.05);
  }
  .cta:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
