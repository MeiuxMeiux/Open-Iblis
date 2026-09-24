<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { EngineInfo } from '../../../shared/contract'
  import type { CreateDraft } from '../create-draft.svelte'
  import ProfileSelector from './ProfileSelector.svelte'
  import StylePicker from '../styles/StylePicker.svelte'

  // The option row under the prompt: profile, style, vocals, length, seed.
  // Each field renders only when the selected engine's signed capabilities
  // declare it (roadmap 4D); the engine picker sits above in Generate.
  let {
    info,
    draft,
    ready,
    onselectprofile
  }: {
    info: EngineInfo | null
    draft: CreateDraft
    ready: boolean
    onselectprofile: (id: string) => void
  } = $props()

  const caps = $derived(info?.capabilities ?? null)
  const showLyrics = $derived(caps?.lyrics !== 'none')
  const showStyles = $derived(!caps || caps.styles)
  const showSeed = $derived(!caps || caps.seed)
  const minSec = $derived(caps?.duration.minSec ?? 4)
  const maxSec = $derived(caps?.duration.maxSec ?? 240)
</script>

<div class="row">
  <ProfileSelector
    profiles={info?.profiles ?? []}
    selected={draft.presetId}
    disabled={!ready}
    onselect={onselectprofile}
  />
  {#if showStyles}
    <StylePicker
      steering={draft.steering}
      liveAdapters={info?.runtime?.adapters ?? null}
      disabled={!ready}
    />
  {/if}
  {#if showLyrics}
    <label class="field">
      <span>Vocals</span>
      <select bind:value={draft.steering.vocals} disabled={!ready}>
        <option value="instrumental">Instrumental</option>
        <option value="lyrics">My lyrics</option>
        {#if !caps || caps.autoLyrics}
          <option value="auto">Engine writes lyrics</option>
        {/if}
      </select>
    </label>
  {/if}
  <label class="field seed">
    <span>Length (sec, {minSec} to {maxSec})</span>
    <input
      type="number"
      min={minSec}
      max={maxSec}
      step="any"
      bind:value={draft.lengthSec}
      disabled={!ready}
    />
  </label>
  {#if showSeed}
    <label class="field seed">
      <span>Synthesis seed (optional)</span>
      <input
        bind:value={draft.seedText}
        placeholder="random"
        inputmode="numeric"
        disabled={!ready}
      />
    </label>
  {/if}
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1 1 150px;
    min-width: 150px;
  }
  .field span {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .seed {
    flex: 1 1 130px;
    min-width: 130px;
    max-width: 220px;
  }
  input,
  select {
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    padding: 9px 11px;
    font-size: 13.5px;
    font-family: inherit;
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-color: var(--color-accent);
  }
</style>
