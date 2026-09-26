<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { StemFileView } from '../../../shared/stems'
  import { buildWaveformGeometry } from '../player/waveform-geometry'
  import Icon from '../ui/Icon.svelte'
  import { STEM_ICONS, stemBadges, stemColorVar, stemLabel } from './presentation'
  import type { LaneState } from './stem-mixer.svelte'

  let {
    stem,
    lane,
    audible,
    progress,
    onmute,
    onsolo,
    ongain,
    onseek,
    ondrag,
    onreveal
  }: {
    stem: StemFileView
    lane: LaneState
    audible: boolean
    progress: number
    onmute: () => void
    onsolo: () => void
    ongain: (gain: number) => void
    onseek: (ratio: number) => void
    ondrag: () => void
    onreveal: () => void
  } = $props()

  // Coarse bars read better than hairlines at drawer width.
  const WIDTH = 160
  const HEIGHT = 40
  const geometry = $derived(
    buildWaveformGeometry(
      { frames: 0, sampleRateHz: 0, durationSec: stem.durationSec, ...stem.peaks },
      WIDTH,
      HEIGHT,
      'mirrored',
      2
    )
  )
  const label = $derived(stemLabel(stem.role))

  function seek(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    onseek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)))
  }

  function seekKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') onseek(Math.max(0, progress - 0.02))
    else if (event.key === 'ArrowRight') onseek(Math.min(1, progress + 0.02))
  }
</script>

<div class="lane" class:dim={!audible} style:--lane={stemColorVar(stem.role)}>
  <button
    class="grip"
    draggable="true"
    ondragstart={(event) => {
      event.preventDefault()
      ondrag()
    }}
    title="Drag {label} into your DAW or a folder"
    aria-label="Drag {label} stem out"
  >
    <Icon name={STEM_ICONS[stem.role]} size={18} />
  </button>

  <div class="body">
    <div class="top">
      <span class="name">{label}</span>
      {#each stemBadges(stem) as badge (badge.text)}
        <span class="chip" title={badge.title}
          ><Icon name={badge.icon} size={11} />{badge.text}</span
        >
      {/each}
      {#if stem.silent}
        <span
          class="chip quiet"
          title="This stem is nearly silent; the track may not contain this part"
        >
          <Icon name="volume-muted" size={11} />near silent
        </span>
      {/if}
      <span class="level" title="Peak and RMS level of this stem"
        >{stem.peakDb.toFixed(1)} dB peak</span
      >
    </div>
    <div
      class="wave"
      role="slider"
      tabindex="0"
      aria-label="{label} position"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(progress * 100)}
      onclick={seek}
      onkeydown={seekKey}
    >
      {#if geometry}
        <svg viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
          <path d={geometry.path} />
        </svg>
      {/if}
      <span class="played" style:width="{progress * 100}%"></span>
      <span class="head" style:left="{progress * 100}%"></span>
    </div>
  </div>

  <div class="controls">
    <button
      class="toggle solo"
      class:on={lane.solo}
      onclick={onsolo}
      title="Solo {label}"
      aria-label="Solo {label}"
      aria-pressed={lane.solo}>S</button
    >
    <button
      class="toggle mute"
      class:on={lane.muted}
      onclick={onmute}
      title="Mute {label}"
      aria-label="Mute {label}"
      aria-pressed={lane.muted}>M</button
    >
    <input
      class="gain"
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={lane.gain}
      oninput={(event) => ongain(Number(event.currentTarget.value))}
      aria-label="{label} volume"
      title="{label} volume"
    />
    <button
      class="reveal"
      onclick={onreveal}
      title="Show {label} in folder"
      aria-label="Show {label} in folder"
    >
      <Icon name="folder" size={13} />
    </button>
  </div>
</div>

<style>
  @import './stem-lane.css';
</style>
