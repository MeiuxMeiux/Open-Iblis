<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type {
    CloudDefaultTask,
    CloudProviderId,
    CloudProvidersSnapshot,
    CloudTask,
    ModelSummaryV1
  } from '../../../shared/cloud-providers'

  interface Props {
    snapshot: CloudProvidersSnapshot
    busy: boolean
    onSetDefault: (task: CloudDefaultTask, modelId?: string) => void
  }

  let { snapshot, busy, onSetDefault }: Props = $props()
  let search = $state('')
  let providerFilter = $state<'all' | CloudProviderId>('all')
  let modalityFilter = $state<'all' | 'text' | 'image'>('all')
  let capabilityFilter = $state<'all' | CloudTask>('all')
  let priceFilter = $state<'all' | 'free' | 'paid'>('all')
  let minContext = $state(0)
  let maxPrice = $state(0)

  const defaults: { task: CloudDefaultTask; label: string; provider: CloudProviderId }[] = [
    { task: 'song-ideas', label: 'Idea model', provider: 'openrouter' },
    { task: 'lyrics-assistance', label: 'Lyrics model', provider: 'openrouter' },
    { task: 'cover-generation', label: 'Cover model', provider: 'imagerouter' }
  ]

  function models(): ModelSummaryV1[] {
    const term = search.trim().toLowerCase()
    return snapshot.models.filter(
      (model) =>
        (providerFilter === 'all' || model.provider === providerFilter) &&
        (capabilityFilter === 'all' ||
          (capabilityFilter === 'cover-generation'
            ? model.outputModalities.includes('image')
            : model.outputModalities.includes('text'))) &&
        (modalityFilter === 'all' || model.outputModalities.includes(modalityFilter)) &&
        (priceFilter === 'all' || (priceFilter === 'free') === model.free) &&
        (!minContext || (model.contextWindow ?? 0) >= minContext) &&
        (!maxPrice ||
          (model.price?.max ?? model.price?.typical ?? model.price?.inputPerMillion ?? Infinity) <=
            maxPrice) &&
        (!term || `${model.name} ${model.id}`.toLowerCase().includes(term))
    )
  }

  function price(model: ModelSummaryV1): string {
    const value = model.price
    if (!value) return 'Price not reported'
    if (value.min !== undefined) {
      return `min $${value.min.toFixed(3)}; typical $${(value.typical ?? value.min).toFixed(3)}; max $${(value.max ?? value.typical ?? value.min).toFixed(3)} per image`
    }
    return `$${(value.inputPerMillion ?? 0).toFixed(2)} input / $${(value.outputPerMillion ?? 0).toFixed(2)} output per M tokens`
  }
</script>

<section class="defaults">
  <h3>Task defaults</h3>
  {#each defaults as item (item.task)}
    {@const defaultId = snapshot.defaults[item.task] ?? ''}
    <label>
      <span>{item.label}</span>
      <select
        value={defaultId}
        disabled={busy}
        onchange={(event) => onSetDefault(item.task, event.currentTarget.value || undefined)}
      >
        <option value="">No default selected</option>
        {#if defaultId && !snapshot.models.some((model) => model.id === defaultId)}
          <option value={defaultId}>{defaultId} (unavailable)</option>
        {/if}
        {#each snapshot.models.filter((model) => model.provider === item.provider && (item.task === 'cover-generation' ? model.outputModalities.includes('image') : model.outputModalities.includes('text'))) as model (model.id)}
          <option value={model.id}>{model.name} — {model.id}</option>
        {/each}
      </select>
    </label>
  {/each}
</section>

<section class="registry">
  <div class="head">
    <h3>Models</h3>
    <input bind:value={search} placeholder="Search models" aria-label="Search models" />
    <select bind:value={providerFilter} aria-label="Filter models by provider">
      <option value="all">All providers</option><option value="openrouter">OpenRouter</option
      ><option value="imagerouter">ImageRouter</option>
    </select>
    <select bind:value={modalityFilter} aria-label="Filter models by modality">
      <option value="all">All modalities</option><option value="text">Text output</option><option
        value="image">Image output</option
      >
    </select>
    <select bind:value={capabilityFilter} aria-label="Filter models by capability">
      <option value="all">All capabilities</option><option value="song-ideas">Song ideas</option
      ><option value="lyrics-assistance">Lyrics assistance</option><option value="cover-generation"
        >Cover generation</option
      >
    </select>
    <select bind:value={priceFilter} aria-label="Filter models by price">
      <option value="all">Free and paid</option><option value="free">Free</option><option
        value="paid">Paid</option
      >
    </select>
    <input
      bind:value={minContext}
      type="number"
      min="0"
      placeholder="Minimum context"
      aria-label="Minimum context window"
    />
    <input
      bind:value={maxPrice}
      type="number"
      min="0"
      step="0.01"
      placeholder="Maximum reported price"
      aria-label="Maximum reported price"
    />
  </div>
  {#each models() as model (model.provider + model.id)}
    <article class="model">
      <strong>{model.name}</strong><code>{model.id}</code>
      <span>{model.inputModalities.join(', ') || 'none'} → {model.outputModalities.join(', ')}</span
      >
      <span
        >{model.contextWindow
          ? `${model.contextWindow.toLocaleString()} context`
          : 'No context reported'}{model.maxOutput
          ? `; ${model.maxOutput.toLocaleString()} max output`
          : ''}</span
      >
      <span>{model.supportedParameters.join(', ') || 'No controls reported'}</span>
      <span>{model.privacyLabel}</span>
      <span>{price(model)} — provider-reported estimate</span>
    </article>
  {:else}
    <p class="state">
      No cached models match these filters. Refresh a ready provider to load its registry.
    </p>
  {/each}
</section>

<style>
  .defaults,
  .registry,
  .head {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .defaults,
  .registry {
    padding: 14px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--app-bg);
  }
  .defaults {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .defaults h3 {
    grid-column: 1/-1;
  }
  h3 {
    margin: 0;
    font-size: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
  }
  input,
  select {
    min-height: 34px;
    padding: 7px 9px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--app-surface);
    color: var(--color-text-primary);
    font: inherit;
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  input:disabled,
  select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .model {
    display: grid;
    gap: 3px;
    padding: 10px 0;
    border-top: 1px solid var(--color-border-default);
  }
  .model span,
  .model code,
  .state {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--color-text-secondary);
  }
  @media (max-width: 620px) {
    .defaults {
      grid-template-columns: 1fr;
    }
  }
</style>
