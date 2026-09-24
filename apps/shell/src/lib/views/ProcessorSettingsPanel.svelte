<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
  import type { ProcessorSettings } from '../../../shared/processors'
  import ProcessorProviderCard from '../processors/ProcessorProviderCard.svelte'
  import ProcessorBenchmarkPanel from '../processors/ProcessorBenchmarkPanel.svelte'
  import { capabilityName, providerState } from '../processors/presentation'

  const capabilities: ProcessorAnalysisCapability[] = ['bpm-detect', 'key-detect']
  let settings = $state<ProcessorSettings>({ defaults: {}, providers: [], acknowledgements: {} })
  let loading = $state(true)
  let error = $state<string | null>(null)

  onMount(() => void refresh())

  async function refresh(): Promise<void> {
    const result = await window.iblis.processors.settings()
    if (result.ok) {
      settings = result.data
      error = null
    } else {
      error = result.error
    }
    loading = false
  }

  async function clear(capability: ProcessorAnalysisCapability): Promise<void> {
    const result = await window.iblis.processors.setDefault(capability)
    if (result.ok) settings = result.data
    else error = result.error
  }
</script>

<section class="processors" aria-labelledby="processors-heading">
  <div>
    <h2 id="processors-heading">Audio analysis</h2>
    <p class="hint">
      Detected evidence stays separate from generation targets. Choose BPM and key providers
      independently; Iblis never silently changes one default when you select the other.
    </p>
  </div>

  {#if loading}
    <p class="state" role="status">Checking installed audio providers…</p>
  {:else}
    <section class="defaults" aria-label="Active analysis defaults">
      <h3>Active defaults</h3>
      {#each capabilities as capability (capability)}
        {@const selected = settings.providers.find(
          (provider) => provider.id === settings.defaults[capability]
        )}
        <div class="default">
          <span>{capabilityName(capability)}</span>
          <strong
            >{selected ? `${selected.name} ${selected.version}` : 'No provider selected'}</strong
          >
          {#if selected}
            <button onclick={() => void clear(capability)}>Turn off</button>
          {/if}
        </div>
        <small>{providerState(settings, capability)}</small>
      {/each}
    </section>

    <section aria-labelledby="installed-providers-heading">
      <h3 id="installed-providers-heading">Installed providers</h3>
      {#if settings.providers.length === 0}
        <p class="state">No approved audio provider is installed. Detection remains off.</p>
      {:else}
        <div class="cards">
          {#each settings.providers as provider (provider.id)}
            <ProcessorProviderCard
              {provider}
              {settings}
              onSettings={(next: ProcessorSettings) => (settings = next)}
            />
          {/each}
        </div>
      {/if}
    </section>
    <ProcessorBenchmarkPanel {settings} />
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .processors {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
  }
  h2,
  h3 {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }
  h3 {
    margin-bottom: var(--space-2);
    font-size: var(--font-size-xs);
  }
  .hint,
  .state,
  .error,
  small {
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-xs);
    line-height: 1.45;
    color: var(--color-text-secondary);
  }
  .defaults {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-2) var(--space-4);
  }
  .defaults h3 {
    grid-column: 1 / -1;
  }
  .default {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .default span {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  .default strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-sm);
  }
  button {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-primary);
    padding: 4px var(--space-2);
    font: inherit;
    font-size: var(--font-size-xs);
  }
  button:hover {
    background: var(--app-surface-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .cards {
    display: grid;
    gap: var(--space-3);
  }
  .error {
    color: var(--color-danger);
  }
</style>
