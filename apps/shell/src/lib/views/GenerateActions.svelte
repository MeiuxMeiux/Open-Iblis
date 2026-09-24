<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  // The Create actions (Generate + quality compare), split out of
  // Generate.svelte so the view stays under the LOC cap. Local generation is
  // free and never needs a product key (D-O2).
  import type { EngineProfile } from '../../../shared/contract'
  import type { QueueComparisonVariant } from '../../../shared/generation-queue'
  import QualityCompare from './QualityCompare.svelte'
  import Icon from '../ui/Icon.svelte'

  let {
    profiles,
    canGenerate,
    actionLabel,
    busy,
    ongenerate,
    oncompare
  }: {
    profiles: EngineProfile[]
    canGenerate: boolean
    actionLabel: string
    busy: boolean
    ongenerate: () => void
    oncompare: (variant: QueueComparisonVariant) => void
  } = $props()
</script>

<button class="go" onclick={ongenerate} disabled={!canGenerate}>
  <Icon name="create" size={16} />
  <span>{actionLabel}</span>
</button>
<QualityCompare {profiles} disabled={!canGenerate || busy} {oncompare} />

<style>
  .go {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    padding: 9px 22px;
    border-radius: var(--radius-lg);
    font-size: 14px;
    transition:
      opacity 0.12s ease,
      background 0.12s ease;
  }
  .go:disabled {
    opacity: 0.4;
  }
</style>
