<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script module lang="ts">
  let nextWaveformId = 0
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import type { WaveformAnalysisState } from '../waveform-analysis.svelte'
  import { formatTime } from './format'
  import {
    buildWaveformGeometry,
    silenceRegions,
    type WaveformMode,
    waveformAnalysisDisplay
  } from './waveform-geometry'

  let {
    title,
    trackId,
    durationSec,
    timeSec,
    canSeek,
    analysisState,
    mode = 'peaks',
    onpreview,
    oncommit
  }: {
    title: string
    trackId: string | null
    durationSec: number | null
    timeSec: number
    canSeek: boolean
    analysisState: WaveformAnalysisState
    mode?: WaveformMode
    onpreview: (timeSec: number | null) => void
    oncommit: (timeSec: number) => void
  } = $props()

  let hoverTime = $state<number | null>(null)
  let rail = $state<HTMLDivElement>()
  const boundRail = (): HTMLDivElement | undefined => rail
  let measuredWidth = $state(0)
  let measuredHeight = $state(0)
  let measureFrame = 0
  // The counter lives in <script module>; each instance's increment is read by the next.
  // eslint-disable-next-line no-useless-assignment
  const clipId = `waveform-played-${++nextWaveformId}`
  const total = $derived(durationSec ?? 0)
  const progress = $derived(total > 0 ? Math.min(1, Math.max(0, timeSec / total)) : 0)
  const hoverProgress = $derived(
    total > 0 && hoverTime !== null ? Math.min(1, Math.max(0, hoverTime / total)) : 0
  )
  const analysisDisplay = $derived(waveformAnalysisDisplay(analysisState, trackId, durationSec))
  const readyAnalysis = $derived(analysisDisplay.analysis)
  const geometry = $derived(
    readyAnalysis
      ? buildWaveformGeometry(readyAnalysis.peaks, measuredWidth, measuredHeight, mode)
      : null
  )
  const silence = $derived(
    readyAnalysis
      ? silenceRegions(readyAnalysis.audible, readyAnalysis.source.frames)
      : { leadingRatio: 0, trailingRatio: 0 }
  )
  const analysisLabel = $derived(mode === 'timeline' ? null : analysisDisplay.label)

  function value(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value)
  }

  function pointerTime(event: PointerEvent): number | null {
    if (!canSeek || total <= 0) return null
    const rect = (event.currentTarget as HTMLInputElement).getBoundingClientRect()
    if (rect.width <= 0) return null
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    return ratio * total
  }

  onMount(() => {
    // Guard through a call so narrowing stays out of the frame callback, which
    // re-reads the live bind:this element.
    const mounted = boundRail()
    if (!mounted) return
    const measure = (): void => {
      if (measureFrame) return
      measureFrame = requestAnimationFrame(() => {
        measureFrame = 0
        const rect = rail?.getBoundingClientRect()
        measuredWidth = rect ? Math.round(rect.width) : 0
        measuredHeight = rect ? Math.round(rect.height) : 0
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(mounted)
    measure()
    return () => {
      observer.disconnect()
      if (measureFrame) cancelAnimationFrame(measureFrame)
    }
  })
</script>

<div class="waveform" class:disabled={!canSeek}>
  <div class="rail" bind:this={rail} aria-hidden="true">
    {#if geometry}
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
      >
        <defs>
          <path id={`${clipId}-path`} d={geometry.path}></path>
          <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
            <rect width={geometry.width * progress} height={geometry.height}></rect>
          </clipPath>
        </defs>
        <use class="peaks unplayed" href={`#${clipId}-path`}></use>
        <use class="peaks played" href={`#${clipId}-path`} clip-path={`url(#${clipId})`}></use>
      </svg>
    {:else}
      <div class="played-rail" style:width={`${progress * 100}%`}></div>
    {/if}
    {#if silence.leadingRatio > 0}
      <div class="silence leading" style:width={`${silence.leadingRatio * 100}%`}></div>
    {/if}
    {#if silence.trailingRatio > 0}
      <div class="silence trailing" style:width={`${silence.trailingRatio * 100}%`}></div>
    {/if}
    <div class="playhead" style:left={`${progress * 100}%`}></div>
    {#if hoverTime !== null}
      <div class="hover" style:left={`${hoverProgress * 100}%`}></div>
      <span class="tooltip" style:left={`${hoverProgress * 100}%`}>{formatTime(hoverTime)}</span>
    {/if}
  </div>
  {#if analysisLabel}<span class="analysis-status" role="status">{analysisLabel}</span>{/if}
  <input
    type="range"
    aria-label={`Seek ${title}`}
    aria-valuetext={`${formatTime(timeSec)} of ${formatTime(durationSec)}`}
    min="0"
    max={total || 1}
    step="any"
    value={Math.min(total || 1, Math.max(0, timeSec))}
    disabled={!canSeek}
    oninput={(event) => onpreview(value(event))}
    onchange={(event) => oncommit(value(event))}
    onpointermove={(event) => (hoverTime = pointerTime(event))}
    onpointerleave={() => (hoverTime = null)}
    onpointercancel={() => {
      hoverTime = null
      onpreview(null)
    }}
  />
</div>

<style>
  .waveform {
    position: relative;
    min-width: 120px;
    height: 40px;
    border-radius: var(--radius-md);
  }
  .rail {
    position: absolute;
    inset: 5px 0;
    overflow: hidden;
    border-radius: var(--radius-md);
    background:
      repeating-linear-gradient(
        90deg,
        transparent 0,
        transparent 23px,
        color-mix(in srgb, var(--wave-peak) 12%, transparent) 24px
      ),
      var(--wave-bg);
  }
  .played-rail {
    position: absolute;
    inset: 0 auto 0 0;
    background: color-mix(in srgb, var(--wave-fg) 28%, transparent);
  }
  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
  .peaks {
    fill: none;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .peaks.unplayed {
    stroke: var(--wave-peak);
  }
  .peaks.played {
    stroke: var(--wave-fg);
  }
  .silence {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 1;
    background: var(--wave-bg);
    opacity: 0.62;
    pointer-events: none;
  }
  .silence.leading {
    left: 0;
  }
  .silence.trailing {
    right: 0;
  }
  .playhead,
  .hover {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    z-index: 2;
    pointer-events: none;
  }
  .playhead {
    background: var(--wave-playhead);
  }
  .hover {
    background: color-mix(in srgb, var(--wave-peak) 70%, transparent);
  }
  .analysis-status {
    position: absolute;
    inset: 0;
    display: grid;
    z-index: 2;
    place-items: center;
    color: var(--color-text-muted);
    font-size: 10px;
    letter-spacing: 0.02em;
    pointer-events: none;
  }
  .tooltip {
    position: absolute;
    top: 1px;
    z-index: 3;
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-elevated);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    transform: translateX(-50%);
    pointer-events: none;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .waveform:focus-within {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .waveform.disabled {
    opacity: 0.55;
  }
  .waveform.disabled input {
    cursor: default;
  }
</style>
