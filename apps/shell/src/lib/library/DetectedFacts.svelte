<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // Detected tempo and key of the final audio (default analysis providers),
  // as compact icon chips. Never used for generation targets.
  import type { LibraryTrack } from '../../../shared/contract'
  import Icon from '../ui/Icon.svelte'
  import { detectedMusicalMetadata } from './track-metadata'

  let { track }: { track: LibraryTrack | null } = $props()
  const detected = $derived(detectedMusicalMetadata(track))
</script>

{#if detected.bpm ?? detected.key}
  <span class="facts">
    {#if detected.bpm}
      <span class="fact" title="Detected tempo of the final audio">
        <Icon name="metronome" size={11} />{detected.bpm}
      </span>
    {/if}
    {#if detected.key}
      <span class="fact" title="Detected key of the final audio">
        <Icon name="key" size={11} />{detected.key}
      </span>
    {/if}
  </span>
{/if}

<style>
  .facts {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    vertical-align: middle;
  }
  .fact {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 var(--space-2);
    border: 1px solid color-mix(in srgb, var(--color-accent) 35%, transparent);
    border-radius: var(--radius-full);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    line-height: 1.6;
    white-space: nowrap;
    color: color-mix(in srgb, var(--color-accent) 80%, var(--color-text-primary));
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
</style>
