<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // The calm, non-dismissible resource-lock banner Create and Training share.
  let { text }: { text: string | null } = $props()
</script>

{#if text}
  <p class="banner" role="status">{text}</p>
{/if}

<style>
  .banner {
    margin: 0;
    padding: 10px 14px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
    color: var(--color-text-primary);
    font-size: 13px;
  }
</style>
