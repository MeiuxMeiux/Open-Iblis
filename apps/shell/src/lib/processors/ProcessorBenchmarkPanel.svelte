<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import type { LibraryTrack } from '../../../shared/contract'
  import type {
    ProcessorBenchmarkView,
    ProcessorProviderView,
    ProcessorSettings
  } from '../../../shared/processors'
  import { legalStatus } from './presentation'
  import ProcessorBenchmarkResults from './ProcessorBenchmarkResults.svelte'
  import ProcessorTrackPicker from './ProcessorTrackPicker.svelte'

  const QUEUE_TIMEOUT_MS = 30_000

  let { settings }: { settings: ProcessorSettings } = $props()
  let tracks = $state<LibraryTrack[]>([])
  let benchmarks = $state<ProcessorBenchmarkView[]>([])
  let trackId = $state('')
  let providerIds = $state<string[]>([])
  let loading = $state(true)
  let queueing = $state(false)
  let error = $state<string | null>(null)
  let notice = $state<string | null>(null)
  let refreshTimer: ReturnType<typeof setInterval> | undefined

  const audioTracks = $derived(tracks.filter((track) => track.format.toLowerCase() === 'wav'))
  const selectedProviders = $derived(
    settings.providers.filter((provider) => providerIds.includes(provider.id))
  )

  onMount(() => {
    void refresh()
    refreshTimer = setInterval(() => void refreshBenchmarks(), 750)
  })
  onDestroy(() => refreshTimer && clearInterval(refreshTimer))

  async function refresh(): Promise<void> {
    const [trackResult, benchmarkResult] = await Promise.all([
      window.iblis.library.list(),
      window.iblis.processors.benchmarks()
    ])
    if (trackResult.ok) {
      tracks = trackResult.data
      const firstWav = trackResult.data.find((track) => track.format.toLowerCase() === 'wav')
      if (!trackId && firstWav) trackId = firstWav.id
    } else error = trackResult.error
    if (benchmarkResult.ok) benchmarks = benchmarkResult.data
    else error = benchmarkResult.error
    loading = false
  }
  async function refreshBenchmarks(): Promise<void> {
    const result = await window.iblis.processors.benchmarks()
    if (result.ok) benchmarks = result.data
  }
  function toggle(provider: ProcessorProviderView): void {
    providerIds = providerIds.includes(provider.id)
      ? providerIds.filter((id) => id !== provider.id)
      : [...providerIds, provider.id]
  }
  function timeLimit<T>(work: Promise<T>, milliseconds: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const limit = new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('comparison request timed out')), milliseconds)
    })
    return Promise.race([work, limit]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout)
    })
  }
  async function queue(): Promise<void> {
    error = null
    notice = null
    if (selectedProviders.length < 2) {
      error = 'Choose at least two provider buttons below before starting the comparison.'
      return
    }
    queueing = true
    try {
      const result = await timeLimit(
        window.iblis.processors.benchmark(trackId, $state.snapshot(providerIds)),
        QUEUE_TIMEOUT_MS
      )
      if (!result.ok) {
        error = result.error
        return
      }
      benchmarks = [
        result.data,
        ...benchmarks.filter((benchmark) => benchmark.id !== result.data.id)
      ]
      notice = 'Benchmark queued. It uses the selected providers only and does not change defaults.'
    } catch {
      error =
        'The comparison request did not finish. The controls are available again; Iblis will keep checking for any queued result.'
    } finally {
      queueing = false
    }
  }
  async function exportBenchmark(id: string): Promise<void> {
    error = null
    notice = null
    const result = await window.iblis.processors.exportBenchmark(id)
    if (!result.ok) error = result.error
    else if (result.data) notice = 'Benchmark export saved.'
  }
</script>

<section class="benchmark" aria-labelledby="benchmark-heading">
  <div>
    <h3 id="benchmark-heading">Compare providers</h3>
    <p>
      Run explicitly chosen installed providers against one immutable WAV. This does not change BPM
      or key defaults, and exports contain no audio or filesystem paths.
    </p>
  </div>
  {#if loading}
    <p class="state" role="status">Loading tracks and benchmark history…</p>
  {:else if audioTracks.length === 0}
    <p class="state">Add a WAV track to the Library before starting a comparison.</p>
  {:else if settings.providers.length < 2}
    <p class="state">Install at least two audio-analysis providers to compare them.</p>
  {:else}
    <div class="setup">
      <ProcessorTrackPicker
        tracks={audioTracks}
        value={trackId}
        onSelect={(id: string) => (trackId = id)}
      />
      <fieldset>
        <legend>Installed providers</legend>
        <p class="selection-help">
          Choose at least two. These benchmark choices are independent of Active defaults above.
        </p>
        {#each settings.providers as provider (provider.id)}
          <button
            class="provider"
            aria-pressed={providerIds.includes(provider.id)}
            onclick={() => toggle(provider)}
            ><span>{provider.name} {provider.version}</span><small
              >{legalStatus(provider.legalStatus)} · {providerIds.includes(provider.id)
                ? 'Selected for comparison'
                : 'Not selected'}</small
            ></button
          >
        {/each}
      </fieldset>
      <button disabled={queueing || !trackId} onclick={() => void queue()}
        >{queueing
          ? 'Queueing comparison…'
          : `Benchmark ${selectedProviders.length || 'selected'} providers`}</button
      >
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <ProcessorBenchmarkResults {benchmarks} onExport={(id: string) => void exportBenchmark(id)} />
</section>

<style>
  .benchmark,
  .setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  h3,
  p {
    margin: 0;
  }
  h3,
  p,
  small {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }
  h3 {
    font-weight: var(--font-weight-semibold);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .setup {
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
  }
  legend {
    padding: 0;
    margin-bottom: var(--space-2);
  }
  button {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
  }
  button {
    align-self: flex-start;
    min-height: 34px;
    padding: 6px var(--space-3);
    font-size: var(--font-size-sm);
  }
  .provider {
    align-self: stretch;
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    justify-content: space-between;
    text-align: left;
  }
  .provider[aria-pressed='true'] {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  button:hover:not(:disabled) {
    background: var(--app-surface-hover);
  }
  button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .error {
    color: var(--color-danger);
  }
  .notice {
    color: var(--color-success);
  }
  .selection-help {
    margin: 0 0 var(--space-1);
    color: var(--color-text-muted);
  }
</style>
