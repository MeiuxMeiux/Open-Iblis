<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { VolumeControlStyle } from '../display-preferences'
  import Icon from '../ui/Icon.svelte'

  let {
    variant,
    volume,
    muted,
    ontoggle,
    onvolume
  }: {
    variant: VolumeControlStyle
    volume: number
    muted: boolean
    ontoggle: () => void
    onvolume: (volume: number) => void
  } = $props()

  const effectiveVolume = $derived(muted ? 0 : volume)
  const volumePercent = $derived(Math.round(effectiveVolume * 100))
  const dialStyle = $derived(
    `--volume-fill: ${volumePercent * 0.75}%; --volume-angle: ${-135 + volumePercent * 2.7}deg`
  )

  function setVolume(event: Event): void {
    onvolume(Number((event.currentTarget as HTMLInputElement).value))
  }
</script>

<div class="volume" class:vertical={variant === 'vertical'} class:knob={variant === 'knob'}>
  <button
    class="mute"
    aria-label={muted ? 'Unmute' : 'Mute'}
    title={muted ? 'Unmute' : 'Mute'}
    aria-pressed={muted}
    onclick={ontoggle}
  >
    <Icon name={muted ? 'volume-muted' : 'volume'} size={17} />
  </button>

  {#if variant === 'knob'}
    <label class="dial" style={dialStyle} title={`Volume ${volumePercent}%`}>
      <span class="dial-face" aria-hidden="true"></span>
      <span class="sr-only">Volume</span>
      <input
        type="range"
        aria-label="Volume"
        aria-valuetext={`${volumePercent}%`}
        min="0"
        max="1"
        step="0.01"
        value={effectiveVolume}
        oninput={setVolume}
      />
    </label>
  {:else}
    <input
      class:vertical-range={variant === 'vertical'}
      type="range"
      aria-label="Volume"
      aria-valuetext={`${volumePercent}%`}
      min="0"
      max="1"
      step="0.01"
      value={effectiveVolume}
      oninput={setVolume}
    />
  {/if}
</div>

<style>
  .volume {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .volume.vertical {
    align-items: center;
  }
  .mute {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    padding: 0;
    color: var(--color-text-secondary);
    background: transparent;
    border: 0;
  }
  .mute:hover,
  .mute[aria-pressed='true'] {
    color: var(--color-text-primary);
  }
  input {
    width: 76px;
    accent-color: var(--color-accent);
  }
  .vertical-range {
    width: 20px;
    height: 48px;
    writing-mode: vertical-lr;
    direction: rtl;
  }
  .dial {
    position: relative;
    width: 42px;
    height: 42px;
    display: block;
    flex: 0 0 auto;
    border-radius: var(--radius-full);
  }
  .dial-face {
    position: absolute;
    inset: 3px;
    border-radius: var(--radius-full);
    background: conic-gradient(
      from 225deg,
      var(--color-accent) 0 var(--volume-fill),
      var(--color-border-default) var(--volume-fill) 75%,
      transparent 75% 100%
    );
    box-shadow: var(--shadow-sm);
    pointer-events: none;
  }
  .dial-face::before {
    content: '';
    position: absolute;
    inset: 7px;
    border-radius: var(--radius-full);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-default);
  }
  .dial-face::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 8px;
    width: 2px;
    height: 9px;
    border-radius: var(--radius-full);
    background: var(--color-text-primary);
    transform: translateX(-50%) rotate(var(--volume-angle));
    transform-origin: 50% 10px;
  }
  .dial input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .mute:focus-visible,
  input:focus-visible,
  .dial:focus-within {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    white-space: nowrap;
    border: 0;
    clip: rect(0, 0, 0, 0);
    clip-path: inset(50%);
  }
</style>
