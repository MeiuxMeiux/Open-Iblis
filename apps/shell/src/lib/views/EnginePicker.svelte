<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { InstalledEngineSummary } from '../../../shared/contract'
  import EngineCard from './EngineCard.svelte'

  // Engine cards for Create (and the Settings engine section): every
  // installed engine with its signed facts and live readiness. With one
  // engine the card is informational; with more it is a radio group that sets
  // the default target for new takes. Queued work is never retargeted.
  let {
    onchanged,
    disabled = false,
    heading = 'Engine'
  }: { onchanged?: () => void; disabled?: boolean; heading?: string } = $props()

  let engines = $state<InstalledEngineSummary[]>([])

  // Readiness is live state (an on-demand engine starts when a take runs),
  // so the cards refresh on a slow interval while mounted.
  const REFRESH_MS = 4000

  async function refresh(): Promise<void> {
    const r = await window.iblis.engine.list()
    if (r.ok) engines = r.data
  }

  $effect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  })

  async function select(pluginId: string): Promise<void> {
    if (engines.find((engine) => engine.id === pluginId)?.selected) return
    const r = await window.iblis.engine.select(pluginId)
    if (r.ok) engines = r.data
    onchanged?.()
  }

  const selectable = $derived(engines.length > 1)
</script>

{#if engines.length > 0}
  <div class="picker" role={selectable ? 'radiogroup' : undefined} aria-label={heading}>
    <span class="label">{heading}</span>
    <div class="cards">
      {#each engines as engine (engine.id)}
        <EngineCard {engine} {selectable} {disabled} onselect={(id: string) => void select(id)} />
      {/each}
    </div>
  </div>
{/if}

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1 1 100%;
  }
  .label {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 10px;
  }
</style>
