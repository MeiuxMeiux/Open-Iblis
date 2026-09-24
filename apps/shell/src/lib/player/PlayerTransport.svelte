<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import {
    readDisplayPreferences,
    writePlayerDisplayPreferences,
    type PlayerDisplayPreferences
  } from '../display-preferences'
  import { library } from '../library.svelte'
  import { targetMusicalMetadata } from '../library/track-metadata'
  import { queue } from '../queue.svelte'
  import { player } from '../player.svelte'
  import { waveformAnalysis } from '../waveform-analysis.svelte'
  import Icon from '../ui/Icon.svelte'
  import { formatAudio, formatGeneration, formatTime } from './format'
  import PlayerOptions from './PlayerOptions.svelte'
  import VolumeControl from './VolumeControl.svelte'
  import Waveform from './Waveform.svelte'

  let display = $state<PlayerDisplayPreferences>(readDisplayPreferences().player)
  let refreshedDoneAt = 0

  const generationLabel = $derived(
    queue.active?.job ? formatGeneration(queue.active.job.status) : queue.active ? 'Starting' : null
  )
  const target = $derived(targetMusicalMetadata(player.track))

  $effect(() => {
    void queue.initialize()
    void library.refresh()
  })

  $effect(() => {
    const latest = Math.max(
      0,
      ...queue.entries
        .filter((entry) => entry.status === 'done')
        .map((entry) => entry.finishedAt ?? 0)
    )
    if (latest > refreshedDoneAt) {
      refreshedDoneAt = latest
      void library.refresh()
    }
  })

  $effect(() => {
    void waveformAnalysis.select(display.showWaveform ? player.activeId : null)
  })

  $effect(() => {
    const snapshot: PlayerDisplayPreferences = {
      showTargetMetadata: display.showTargetMetadata,
      showFormat: display.showFormat,
      showWaveform: display.showWaveform,
      showPlaybackRate: display.showPlaybackRate,
      showVolume: display.showVolume,
      showQueueStatus: display.showQueueStatus,
      waveformMode: display.waveformMode,
      volumeStyle: display.volumeStyle,
      playbackRate: display.playbackRate
    }
    writePlayerDisplayPreferences(snapshot)
    player.setPlaybackRate(snapshot.playbackRate)
  })
</script>

<footer class="transport" aria-label="Player">
  <div class="transport-controls">
    <button
      class="skip"
      onclick={() => player.previous()}
      aria-label={player.previousTrack
        ? `Play previous track, ${player.previousTrack.name}`
        : 'Previous track'}
      title={player.previousTrack ? `Previous: ${player.previousTrack.name}` : 'No previous track'}
      disabled={!player.previousTrack}
    >
      <Icon name="chevron-left" size={16} />
    </button>
    <button
      class="play"
      onclick={() => (player.playIntent ? player.pause() : player.play())}
      aria-label={player.track
        ? player.playIntent
          ? `Pause ${player.track.name}`
          : `Play ${player.track.name}`
        : 'Play'}
      disabled={!player.track}
    >
      <Icon name={player.playIntent ? 'pause' : 'play'} size={17} />
    </button>
    <button
      class="skip"
      onclick={() => player.next()}
      aria-label={player.nextTrack ? `Play next track, ${player.nextTrack.name}` : 'Next track'}
      title={player.nextTrack ? `Next: ${player.nextTrack.name}` : 'No next track'}
      disabled={!player.nextTrack}
    >
      <Icon name="chevron-right" size={16} />
    </button>
  </div>

  <div class="identity">
    {#if player.track}
      <strong title={player.track.name}>{player.track.name}</strong>
      {#if display.showFormat || (display.showTargetMetadata && (!!target.bpm || !!target.key))}
        <span class="track-meta">
          {#if display.showFormat}<span>{formatAudio(player.track)}</span>{/if}
          {#if display.showTargetMetadata && target.bpm}
            <span title="Generation target, not detected tempo">{target.bpm} BPM target</span>
          {/if}
          {#if display.showTargetMetadata && target.key}
            <span title="Generation target, not detected key">{target.key} target</span>
          {/if}
        </span>
      {/if}
    {:else}
      <strong>No track selected</strong>
      <span>Choose a Library track to play</span>
    {/if}

    {#if display.showQueueStatus && (!!generationLabel || queue.pendingCount > 0)}
      <div class="generation">
        <span role="status">
          {generationLabel ?? 'Queued'}{queue.pendingCount > 0
            ? ` · ${queue.pendingCount} pending`
            : ''}
        </span>
        {#if queue.active}
          <progress aria-label="Generation progress" max="1" value={queue.active.job?.progress ?? 0}
          ></progress>
        {/if}
      </div>
    {/if}
  </div>

  <div class="timeline" class:compact={!display.showWaveform}>
    {#if display.showWaveform}
      <Waveform
        title={player.track?.name ?? 'No track selected'}
        trackId={player.activeId}
        durationSec={player.durationSec}
        timeSec={player.displayTimeSec}
        canSeek={player.canSeek && player.phase !== 'seeking'}
        analysisState={waveformAnalysis.state}
        mode={display.waveformMode}
        onpreview={(timeSec: number | null) => player.previewSeek(timeSec)}
        oncommit={(timeSec: number) => player.commitSeek(timeSec)}
      />
    {/if}
    <div class="timing">
      {#if player.track}
        <span>{formatTime(player.displayTimeSec)} / {formatTime(player.durationSec)}</span>
      {:else}
        <span>–:–– / –:––</span>
      {/if}
      {#if player.phase === 'loading' || player.phase === 'waiting'}
        <span role="status">{player.phase === 'loading' ? 'Loading audio' : 'Buffering'}</span>
      {:else if player.phase === 'seeking'}
        <span role="status">Seeking</span>
      {:else if player.error}
        <span class="error" role="alert">{player.error}</span>
      {/if}
    </div>
  </div>

  {#if display.showPlaybackRate}
    <label class="speed">
      <span class="sr-only">Playback speed</span>
      <select bind:value={display.playbackRate} aria-label="Playback speed">
        <option value={0.5}>0.5×</option>
        <option value={0.75}>0.75×</option>
        <option value={1}>1×</option>
        <option value={1.25}>1.25×</option>
        <option value={1.5}>1.5×</option>
        <option value={2}>2×</option>
      </select>
    </label>
  {/if}

  {#if display.showVolume}
    <VolumeControl
      variant={display.volumeStyle}
      volume={player.volume}
      muted={player.muted}
      ontoggle={() => player.toggleMuted()}
      onvolume={(volume: number) => player.setVolume(volume)}
    />
  {/if}

  <PlayerOptions
    bind:showTargetMetadata={display.showTargetMetadata}
    bind:showFormat={display.showFormat}
    bind:showWaveform={display.showWaveform}
    bind:showPlaybackRate={display.showPlaybackRate}
    bind:showVolume={display.showVolume}
    bind:showQueueStatus={display.showQueueStatus}
    bind:waveformMode={display.waveformMode}
    bind:volumeStyle={display.volumeStyle}
    bind:playbackRate={display.playbackRate}
  />
</footer>

<style>
  @import './player-transport.css';
</style>
