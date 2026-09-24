<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  let {
    label,
    src,
    boundarySec
  }: {
    label: string
    src: string
    boundarySec?: number
  } = $props()

  let audio: HTMLAudioElement
  let playing = $state(false)
  let currentSec = $state(0)
  let durationSec = $state(0)
  let error = $state<string | null>(null)

  function clock(seconds: number): string {
    return Number.isFinite(seconds) ? `${seconds.toFixed(1)}s` : '0.0s'
  }

  async function playFrom(seconds?: number): Promise<void> {
    error = null
    if (seconds !== undefined) audio.currentTime = Math.max(0, seconds)
    try {
      await audio.play()
    } catch {
      error = 'Playback could not start.'
    }
  }

  function toggle(): void {
    if (audio.paused) void playFrom()
    else audio.pause()
  }
</script>

<section class="player" aria-label={label}>
  <audio
    bind:this={audio}
    {src}
    preload="metadata"
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    onended={() => (playing = false)}
    ontimeupdate={() => (currentSec = audio.currentTime)}
    onloadedmetadata={() => (durationSec = audio.duration)}
    onerror={() => (error = 'Probe audio is unavailable. Run the probe again.')}
  ></audio>
  <div class="head">
    <strong>{label}</strong>
    <span>{clock(currentSec)} / {clock(durationSec)}</span>
  </div>
  <div class="controls">
    <button type="button" onclick={toggle}>{playing ? 'Pause' : 'Play from start'}</button>
    {#if boundarySec !== undefined}
      <button type="button" onclick={() => void playFrom(boundarySec - 1.5)}>
        Play around {boundarySec}s boundary
      </button>
    {/if}
  </div>
  {#if error}<p role="alert">{error}</p>{/if}
</section>

<style>
  .player {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-bg-elevated);
  }
  audio {
    display: none;
  }
  .head,
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .head strong {
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
  }
  .head span,
  p {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }
  .controls {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  button {
    min-height: 32px;
    padding: 5px var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-subtle);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-xs);
  }
  button:hover {
    border-color: var(--color-accent);
    background: var(--app-surface-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  p {
    margin: 0;
    color: var(--color-state-danger);
  }
</style>
