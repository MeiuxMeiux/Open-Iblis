<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onMount } from 'svelte'
  import type { ProcessorAnalysisCapability } from '@iblis/plugin-sdk'
  import type { TrackDetail } from '../../../shared/generation-record'
  import Icon from '../ui/Icon.svelte'
  import ProcessorDetailSections from './ProcessorDetailSections.svelte'
  import EngineTargetRows from './EngineTargetRows.svelte'

  let {
    detail,
    loading,
    error,
    onclose,
    onremix,
    onretry,
    retrying
  }: {
    detail: TrackDetail | null
    loading: boolean
    error: string | null
    onclose: () => void
    onremix: () => void
    onretry: (capability: ProcessorAnalysisCapability) => void
    retrying: ProcessorAnalysisCapability | null
  } = $props()

  let panel = $state<HTMLElement | null>(null)
  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel?.focus()
    return () => previous?.focus()
  })

  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      onclose()
      return
    }
    if (event.key !== 'Tab' || !panel) return
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled])'))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) {
      event.preventDefault()
      panel.focus()
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === panel)
    ) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function seconds(value?: number): string {
    return value === undefined ? 'Unavailable' : `${value.toFixed(3)} s`
  }

  function bytes(value?: number): string {
    if (value === undefined) return 'Unavailable'
    return `${(value / 1024 / 1024).toFixed(2)} MiB (${value.toLocaleString()} bytes)`
  }

  const recipe = $derived(detail?.generation?.resolvedRecipes[0])
  const requested = $derived(detail?.generation?.request.config ?? detail?.track.config)
  // bpm/keyscale have their own plan rows; v2 advanced controls are listed
  // per control by EngineTargetRows from the resolved recipe.
  const requestEntries = $derived(
    Object.entries(requested ?? {}).filter(
      ([key]) => key !== 'bpm' && key !== 'keyscale' && key !== 'advanced'
    )
  )

  function planValue(value: unknown): string {
    return typeof value === 'number' || typeof value === 'string' ? String(value) : 'Not recorded'
  }
</script>

<svelte:window onkeydown={keydown} />
<button class="track-detail-scrim" aria-label="Close track details" onclick={onclose}></button>
<div
  class="track-detail-drawer"
  role="dialog"
  aria-modal="true"
  aria-labelledby="detail-title"
  tabindex="-1"
  bind:this={panel}
>
  <header>
    <div>
      <p class="eyebrow">Track detail</p>
      <h2 id="detail-title">{detail?.track.name ?? 'Loading track'}</h2>
    </div>
    <button class="close" onclick={onclose} aria-label="Close track details" title="Close">
      <Icon name="close" size={14} />
    </button>
  </header>

  {#if loading}
    <p role="status" class="muted">Loading generation record and audio analysis...</p>
  {:else if error}
    <p role="alert" class="error">{error}</p>
  {:else if detail}
    <div class="actions">
      <button class="remix" onclick={onremix}>
        <Icon name="remix" size={14} />
        <span>Remix this recipe</span>
      </button>
    </div>

    {#if detail.provenance !== 'recorded'}
      <p class="notice">
        {detail.provenance === 'imported'
          ? 'This track was imported, so it has audio facts but no Iblis generation recipe.'
          : 'This track predates bounded generation records. Available library and audio facts are shown.'}
      </p>
    {/if}

    <section>
      <h3>Generation targets and resolved plan</h3>
      <p class="notice">These are generation intent, not measurements from the final audio.</p>
      <dl>
        <div>
          <dt>Requested BPM</dt>
          <dd>{planValue(requested?.bpm)}</dd>
        </div>
        <div>
          <dt>Requested key</dt>
          <dd>{planValue(requested?.keyscale)}</dd>
        </div>
        <div>
          <dt>Resolved BPM</dt>
          <dd>{planValue(recipe?.bpm)}</dd>
        </div>
        <div>
          <dt>Resolved key</dt>
          <dd>{planValue(recipe?.keyscale)}</dd>
        </div>
      </dl>
    </section>

    <ProcessorDetailSections {detail} {onretry} {retrying} />

    <section>
      <h3>Durations</h3>
      <dl>
        <div>
          <dt>Requested</dt>
          <dd>{seconds(detail.track.requestedDurationSec)}</dd>
        </div>
        <div>
          <dt>Container</dt>
          <dd>{seconds(detail.track.audio?.durationSec ?? detail.track.durationSec)}</dd>
        </div>
        <div>
          <dt>Audible</dt>
          <dd>{seconds(detail.analysis?.audible.audibleDurationSec)}</dd>
        </div>
      </dl>
    </section>

    <section>
      <h3>Request</h3>
      <h4>Prompt</h4>
      <p class="verbatim">{detail.generation?.request.prompt ?? detail.track.prompt}</p>
      {#if detail.generation?.request.lyrics ?? detail.track.lyrics}
        <h4>Lyrics</h4>
        <p class="verbatim">{detail.generation?.request.lyrics ?? detail.track.lyrics}</p>
      {/if}
      {#if requestEntries.length}
        <dl>
          {#each requestEntries as [key, value] (key)}
            <div>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          {/each}
        </dl>
      {/if}
    </section>

    {#if detail.generation}
      <section>
        <h3>Generation</h3>
        <dl>
          <div>
            <dt>Profile</dt>
            <dd>{detail.generation.request.preset}</dd>
          </div>
          <div>
            <dt>Seed</dt>
            <dd>{detail.generation.request.seed ?? recipe?.seed ?? 'random'}</dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd>
              {detail.generation.engine.pluginId}
              {detail.generation.engine.pluginVersion ?? ''}
            </dd>
          </div>
          <div>
            <dt>Job</dt>
            <dd>{detail.generation.jobId}</dd>
          </div>
          {#if recipe?.lm_model}<div>
              <dt>LM model</dt>
              <dd>{recipe.lm_model}</dd>
            </div>{/if}
          {#if recipe?.synth_model}<div>
              <dt>DiT model</dt>
              <dd>{recipe.synth_model}</dd>
            </div>{/if}
          {#if recipe?.adapter}<div>
              <dt>Adapter</dt>
              <dd>{recipe.adapter} at {recipe.adapter_scale ?? 1}</dd>
            </div>{/if}
          <EngineTargetRows {recipe} />
        </dl>
        <h4>Phase timings</h4>
        <dl>
          {#each detail.generation.phases as phase, i (i)}
            <div>
              <dt>{phase.phase}{phase.engineJobId ? ` (${phase.engineJobId})` : ''}</dt>
              <dd>{phase.durationMs.toLocaleString()} ms</dd>
            </div>
          {/each}
        </dl>
        <h4>Bounded trace</h4>
        <ol class="trace">
          {#each detail.generation.trace as event, i (i)}
            <li>
              {event.event}{event.phase ? `: ${event.phase}` : ''}{event.engineJobId
                ? ` (${event.engineJobId})`
                : ''}
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    <section>
      <h3>Audio facts</h3>
      <dl>
        <div>
          <dt>Format</dt>
          <dd>{detail.track.audio?.codec ?? detail.track.format}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{bytes(detail.track.audio?.containerBytes)}</dd>
        </div>
        <div>
          <dt>Rate</dt>
          <dd>
            {detail.track.audio
              ? `${detail.track.audio.sampleRateHz.toLocaleString()} Hz`
              : 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt>Channels</dt>
          <dd>{detail.track.audio?.channels ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Bit depth</dt>
          <dd>{detail.track.audio?.bitsPerSample ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Peak</dt>
          <dd>{detail.analysis?.peakAmplitude.toFixed(6) ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>RMS</dt>
          <dd>{detail.analysis?.rmsAmplitude.toFixed(6) ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Clipped samples</dt>
          <dd>{detail.analysis?.clippedSamples ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Leading silence</dt>
          <dd>{seconds(detail.analysis?.audible.leadingSilenceSec)}</dd>
        </div>
        <div>
          <dt>Trailing silence</dt>
          <dd>{seconds(detail.analysis?.audible.trailingSilenceSec)}</dd>
        </div>
      </dl>
      {#if detail.analysisError}<p class="muted">{detail.analysisError}</p>{/if}
    </section>
  {/if}
</div>

<style>
  @import './track-detail-drawer.css';
</style>
