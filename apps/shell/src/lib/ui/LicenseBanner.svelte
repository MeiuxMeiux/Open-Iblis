<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // A single, dismissible-per-session notice shown only when a product key
  // that used to work has ended (revoked, expired, device cap). Keyless
  // installs never see it: the local app is free (D-O2, 03 doc §GUI). It sits
  // on Styles, the view whose hosted features the key connects.
  import { licensing } from '../licensing.svelte'
  import { nav } from '../navigation.svelte'
  import Icon from './Icon.svelte'
</script>

{#if licensing.bannerVisible}
  <div class="license-banner" role="status">
    <span class="glyph" aria-hidden="true"><Icon name="shield" size={16} /></span>
    <p class="text">
      Your product key is no longer active, so community Styles are paused. Generation, training,
      and everything on this machine keep working.
    </p>
    <button class="link" onclick={() => nav.go('settings', 'product-key')}>Review key</button>
    <button class="dismiss" aria-label="Dismiss" onclick={() => licensing.dismissBanner()}>
      <Icon name="close" size={14} />
    </button>
  </div>
{/if}

<style>
  .license-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-inset);
  }
  .glyph {
    display: inline-flex;
    color: var(--color-accent);
  }
  .text {
    flex: 1 1 auto;
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    line-height: 1.4;
  }
  .link {
    flex: 0 0 auto;
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-accent);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    font: inherit;
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    cursor: pointer;
  }
  .dismiss {
    flex: 0 0 auto;
    display: inline-flex;
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: var(--space-1);
    border-radius: var(--radius-sm);
  }
  .dismiss:hover {
    color: var(--color-text-primary);
  }
</style>
