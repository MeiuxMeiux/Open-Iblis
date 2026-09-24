<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { ProcessorBenchmarkView } from '../../../shared/processors'
  import { detectedValue, jobStatus, legalStatus } from './presentation'

  let {
    benchmarks,
    onExport
  }: { benchmarks: ProcessorBenchmarkView[]; onExport: (id: string) => void } = $props()

  function jobsFor(
    benchmark: ProcessorBenchmarkView,
    provider: ProcessorBenchmarkView['providers'][number]
  ) {
    return benchmark.jobs.filter(
      (job) => job.pluginId === provider.id && job.pluginVersion === provider.version
    )
  }
  function resultFor(
    benchmark: ProcessorBenchmarkView,
    provider: ProcessorBenchmarkView['providers'][number],
    capability: 'bpm-detect' | 'key-detect'
  ) {
    return benchmark.results.find(
      (result) =>
        result.pluginId === provider.id &&
        result.pluginVersion === provider.version &&
        result.capability === capability
    )
  }
  function providerStatus(
    benchmark: ProcessorBenchmarkView,
    provider: ProcessorBenchmarkView['providers'][number]
  ) {
    const jobs = jobsFor(benchmark, provider)
    const failed = jobs.find((job) => job.status === 'error')
    if (failed) return failed.error?.message ?? 'Analysis failed'
    const active = jobs.find((job) => job.status === 'running' || job.status === 'queued')
    return active ? jobStatus(active) : 'Complete'
  }
  function elapsed(
    benchmark: ProcessorBenchmarkView,
    provider: ProcessorBenchmarkView['providers'][number]
  ): string {
    const values = benchmark.results
      .filter(
        (result) => result.pluginId === provider.id && result.pluginVersion === provider.version
      )
      .map((result) => result.computeMs)
    return values.length ? `${Math.max(...values)} ms` : '—'
  }
  function confidence(value: { confidence: number | null }): string {
    return value.confidence === null ? 'Not reported' : `${Math.round(value.confidence * 100)}%`
  }
  function alternatives(result: NonNullable<ReturnType<typeof resultFor>>): string {
    if (!result.value.alternatives.length) return 'None reported'
    if (result.capability === 'bpm-detect') {
      return result.value.alternatives
        .map((alternative) => `${alternative.bpm.toFixed(1)} BPM (${confidence(alternative)})`)
        .join(', ')
    }
    return result.value.alternatives
      .map(
        (alternative) =>
          `${alternative.pitchClass} ${alternative.mode} (${confidence(alternative)})`
      )
      .join(', ')
  }
</script>

{#if benchmarks.length}
  <div class="history" aria-live="polite">
    <h4>Benchmark results</h4>
    {#each benchmarks as benchmark (benchmark.id)}
      <article class="result">
        <header>
          <div>
            <strong>Track {benchmark.trackId}</strong><small
              >Source SHA-256 {benchmark.sourceSha256}</small
            >
          </div>
          <button onclick={() => onExport(benchmark.id)}>Export JSON</button>
        </header>
        <div class="comparison" role="table" aria-label="Provider comparison">
          <div class="labels" role="row">
            <span role="columnheader">Provider</span><span role="columnheader">BPM</span><span
              role="columnheader">Key</span
            ><span role="columnheader">Elapsed</span><span role="columnheader">Peak memory</span
            ><span role="columnheader">Status</span>
          </div>
          {#each benchmark.providers as provider (`${benchmark.id}:${provider.id}:${provider.version}`)}
            {@const bpm = resultFor(benchmark, provider, 'bpm-detect')}
            {@const key = resultFor(benchmark, provider, 'key-detect')}
            <div class="row" role="row">
              <span role="cell"
                ><strong>{provider.name}</strong><small
                  >{provider.version} · {legalStatus(provider.legalStatus)}</small
                ></span
              >
              <span role="cell"
                >{#if bpm}<strong>{detectedValue(bpm)} ({confidence(bpm.value)})</strong><small
                    >Alternatives: {alternatives(bpm)}</small
                  >{:else}—{/if}</span
              >
              <span role="cell"
                >{#if key}<strong>{detectedValue(key)} ({confidence(key.value)})</strong><small
                    >Alternatives: {alternatives(key)}</small
                  >{:else}—{/if}</span
              >
              <span role="cell">{elapsed(benchmark, provider)}</span>
              <span role="cell">Not reported by protocol v1</span>
              <span role="cell">{providerStatus(benchmark, provider)}</span>
            </div>
          {/each}
        </div>
        <p>
          Source, provider, configuration, legal state, and all raw alternatives are retained in the
          JSON export.
        </p>
      </article>
    {/each}
  </div>
{/if}

<style>
  .history,
  .result,
  header div,
  .row > span {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  h4,
  p {
    margin: 0;
  }
  h4,
  small,
  p {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }
  h4 {
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .result {
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
  }
  header div,
  .row > span {
    gap: var(--space-1);
    min-width: 0;
  }
  button {
    min-height: 34px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-primary);
    padding: 6px var(--space-3);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  button:hover {
    background: var(--app-surface-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .comparison {
    overflow-x: auto;
  }
  .labels,
  .row {
    display: grid;
    grid-template-columns: minmax(150px, 1.2fr) repeat(5, minmax(125px, 1fr));
    gap: var(--space-3);
    min-width: 850px;
    padding: var(--space-2) 0;
    font-size: var(--font-size-xs);
  }
  .labels {
    border-bottom: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    font-weight: var(--font-weight-semibold);
  }
  .row {
    border-bottom: 1px solid var(--color-border-subtle);
  }
  .row:last-child {
    border-bottom: 0;
  }
</style>
