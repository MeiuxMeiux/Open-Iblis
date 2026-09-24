<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { PlaybackRate, VolumeControlStyle } from '../display-preferences'
  import { PLAYBACK_RATES } from '../display-preferences'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'
  import Icon from '../ui/Icon.svelte'
  import type { WaveformMode } from './waveform-geometry'

  // Optional only so the bare `$bindable()` markers carry no fallback: the
  // parent binds every prop.
  let {
    showTargetMetadata = $bindable(),
    showFormat = $bindable(),
    showWaveform = $bindable(),
    showPlaybackRate = $bindable(),
    showVolume = $bindable(),
    showQueueStatus = $bindable(),
    waveformMode = $bindable(),
    volumeStyle = $bindable(),
    playbackRate = $bindable()
  }: {
    showTargetMetadata?: boolean
    showFormat?: boolean
    showWaveform?: boolean
    showPlaybackRate?: boolean
    showVolume?: boolean
    showQueueStatus?: boolean
    waveformMode?: WaveformMode
    volumeStyle?: VolumeControlStyle
    playbackRate?: PlaybackRate
  } = $props()
</script>

<details class="options">
  <summary aria-label="Customize player" title="Customize player">
    <Icon name="settings" size={16} />
  </summary>
  <div class="panel">
    <h2>Player display</h2>

    <div class="selects">
      <label>
        <span>Waveform</span>
        <select bind:value={waveformMode}>
          <option value="peaks">Signed peaks</option>
          <option value="mirrored">Mirrored peaks</option>
          <option value="timeline">Timeline</option>
        </select>
      </label>
      <label>
        <span>Volume control</span>
        <select bind:value={volumeStyle} disabled={!showVolume}>
          <option value="slider">Slider</option>
          <option value="vertical">Vertical bar</option>
          <option value="knob">Knob</option>
        </select>
      </label>
      <label>
        <span>Playback speed</span>
        <select bind:value={playbackRate} disabled={!showPlaybackRate}>
          {#each PLAYBACK_RATES as rate (rate)}
            <option value={rate}>{rate}×</option>
          {/each}
        </select>
      </label>
    </div>

    <div class="switches">
      <ToggleSwitch bind:checked={showTargetMetadata} label="BPM and key targets" />
      <ToggleSwitch bind:checked={showFormat} label="Audio format" />
      <ToggleSwitch bind:checked={showWaveform} label="Waveform" />
      <ToggleSwitch bind:checked={showPlaybackRate} label="Playback speed" />
      <ToggleSwitch bind:checked={showVolume} label="Volume" />
      <ToggleSwitch bind:checked={showQueueStatus} label="Generation status" />
    </div>
  </div>
</details>

<style>
  .options {
    position: relative;
    justify-self: end;
  }
  summary {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover,
  .options[open] summary {
    color: var(--color-text-primary);
    background: var(--color-bg-subtle);
    border-color: var(--color-border-default);
  }
  summary:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .panel {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--space-3));
    z-index: 20;
    width: min(300px, calc(100vw - var(--space-6)));
    max-height: min(620px, 70vh);
    padding: var(--space-4);
    overflow: auto;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }
  h2 {
    margin: 0 0 var(--space-3);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }
  .selects,
  .switches {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .switches {
    margin-top: var(--space-3);
  }
  label {
    display: grid;
    grid-template-columns: 1fr minmax(120px, auto);
    align-items: center;
    gap: var(--space-3);
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  select {
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    color: var(--color-text-primary);
    background: var(--color-bg-inset);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    font: inherit;
  }
  select:disabled {
    opacity: 0.5;
  }
</style>
