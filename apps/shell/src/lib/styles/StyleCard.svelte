<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    subtitle,
    busy = false,
    badges,
    body,
    footer
  }: {
    title: string
    subtitle?: string
    busy?: boolean
    badges?: Snippet
    body?: Snippet
    footer?: Snippet
  } = $props()
</script>

<article class="style-card" class:busy>
  <div class="headline">
    <div class="names">
      <h3>{title}</h3>
      {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
    </div>
    {#if badges}<div class="badges">{@render badges()}</div>{/if}
  </div>
  {#if body}<div class="body">{@render body()}</div>{/if}
  {#if footer}<footer>{@render footer()}</footer>{/if}
</article>

<style>
  .style-card {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
    box-shadow: var(--shadow-sm);
  }
  .style-card.busy {
    opacity: 0.7;
  }
  .headline {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .names {
    min-width: 0;
  }
  h3,
  .subtitle {
    margin: 0;
  }
  h3 {
    color: var(--color-text-primary);
    font-size: var(--font-size-md);
    font-weight: var(--font-weight-semibold);
    overflow-wrap: anywhere;
  }
  .subtitle {
    margin-top: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-1);
  }
  .body {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-2);
    border-top: 1px solid var(--color-border-subtle);
    padding-top: var(--space-3);
  }
  footer :global(.badge) {
    margin-right: auto;
  }
  @media (max-width: 620px) {
    .headline {
      flex-direction: column;
    }
    .badges {
      justify-content: flex-start;
    }
  }
</style>
