<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { StemRole } from '@iblis/plugin-sdk'
  import type { StemSetView } from '../../../shared/stems'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import StemLane from './StemLane.svelte'
  import { StemMixer, laneAudible } from './stem-mixer.svelte'
  import { backendText, clock, durationText, residualQuality } from './presentation'

  let {
    trackId,
    set,
    ondrag,
    onreveal,
    onexport,
    onremove
  }: {
    trackId: string
    set: StemSetView
    ondrag: (role: StemRole) => void
    onreveal: (role: StemRole) => void
    onexport: () => void
    onremove: () => void
  } = $props()

  // One mixer per set; a different set replaces it (keyed by the parent),
  // so capturing the initial props is intended.
  // svelte-ignore state_referenced_locally
  const mixer = new StemMixer(trackId, set)
  onDestroy(() => mixer.destroy())

  const progress = $derived(mixer.duration > 0 ? mixer.position / mixer.duration : 0)
  const quality = $derived(residualQuality(set.residualDb))
  let confirmRemove = $state(false)
</script>

<div class="set">
  <div class="transport">
    <button
      class="play"
      onclick={() => mixer.toggle()}
      disabled={mixer.loading}
      aria-label={mixer.playing ? 'Pause stems' : 'Play stems'}
      title={mixer.loading ? 'Loading stems' : mixer.playing ? 'Pause' : 'Play all stems in sync'}
    >
      <Icon name={mixer.playing ? 'pause' : 'play'} size={16} />
    </button>
    <span class="time">{clock(mixer.position)} / {clock(mixer.duration)}</span>
    <input
      class="scrub"
      type="range"
      min="0"
      max={mixer.duration || 1}
      step="0.01"
      value={mixer.position}
      oninput={(event) => mixer.seek(Number(event.currentTarget.value))}
      aria-label="Stem playback position"
    />
    <Button
      size="sm"
      icon="download"
      onclick={onexport}
      title="Copy every stem into a folder you choose"
    >
      Export
    </Button>
  </div>

  {#if mixer.error}<p class="warn" role="alert">{mixer.error}</p>{/if}

  <div class="lanes">
    {#each set.stems as stem (stem.role)}
      {@const lane = mixer.lanes[stem.role]}
      {#if lane}
        <StemLane
          {stem}
          {lane}
          audible={laneAudible(stem.role, mixer.lanes)}
          {progress}
          onmute={() => mixer.toggleMute(stem.role)}
          onsolo={() => mixer.toggleSolo(stem.role)}
          ongain={(gain: number) => mixer.setGain(stem.role, gain)}
          onseek={(ratio: number) => mixer.seek(ratio * mixer.duration)}
          ondrag={() => ondrag(stem.role)}
          onreveal={() => onreveal(stem.role)}
        />
      {/if}
    {/each}
  </div>

  <footer class="prov">
    <span title="Separation model and provider">
      <Icon name="cube" size={12} />{set.modelLabel} model ({set.model}), {set.providerName}
      {set.providerVersion}
    </span>
    <span title="Where the separation ran and how long it took">
      <Icon name="flame" size={12} />{backendText(set.backend)}, {durationText(set.computeMs)}
    </span>
    <span
      class="q {quality.tone}"
      title="How closely the stems add back up to the original ({set.residualDb.toFixed(
        1
      )} dB error)"
    >
      <Icon name="waveform" size={12} />{quality.text} ({set.residualDb.toFixed(1)} dB)
    </span>
    {#if set.notice}<span class="note">{set.notice}</span>{/if}
    <span class="spacer"></span>
    {#if confirmRemove}
      <span class="confirm">
        Delete these stems? The original track stays.
        <Button size="sm" variant="danger" onclick={onremove}>Delete</Button>
        <Button size="sm" onclick={() => (confirmRemove = false)}>Keep</Button>
      </span>
    {:else}
      <Button
        size="sm"
        variant="ghost"
        icon="trash"
        onclick={() => (confirmRemove = true)}
        title="Move these stems to the trash"
      >
        Delete stems
      </Button>
    {/if}
  </footer>
</div>

<style>
  .set {
    display: grid;
    gap: var(--space-3);
  }
  .transport {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
    box-shadow: var(--shadow-sm);
  }
  .play {
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    cursor: pointer;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 18%, transparent);
  }
  .play:disabled {
    cursor: progress;
    opacity: 0.55;
  }
  .time {
    font-family: var(--font-family-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .scrub {
    flex: 1;
    min-width: 60px;
    accent-color: var(--color-accent);
  }
  .lanes {
    display: grid;
    gap: var(--space-2);
  }
  .prov {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }
  .prov > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .q.success {
    color: var(--color-state-success);
  }
  .q.warning {
    color: var(--color-state-warning);
  }
  .q.danger {
    color: var(--color-state-danger);
  }
  .note {
    color: var(--color-state-warning);
  }
  .spacer {
    flex: 1;
  }
  .confirm {
    gap: var(--space-2);
    color: var(--color-text-secondary);
  }
  .warn {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--color-state-danger);
  }
</style>
