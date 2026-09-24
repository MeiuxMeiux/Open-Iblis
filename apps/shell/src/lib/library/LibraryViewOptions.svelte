<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'
  import Icon from '../ui/Icon.svelte'
  import type { TrackSortOrder } from './track-sort'

  // Optional only so the bare `$bindable()` markers carry no fallback: the
  // parent binds every prop.
  let {
    showTargetMetadata = $bindable(),
    showDetectedAnalysis = $bindable(),
    showPreset = $bindable(),
    showDate = $bindable(),
    showSeed = $bindable(),
    sortOrder = $bindable()
  }: {
    showTargetMetadata?: boolean
    showDetectedAnalysis?: boolean
    showPreset?: boolean
    showDate?: boolean
    showSeed?: boolean
    sortOrder?: TrackSortOrder
  } = $props()
</script>

<details class="view-options">
  <summary title="Customize Library rows">
    <Icon name="settings" size={14} />
    <span>View</span>
  </summary>
  <div class="panel">
    <h3>Sort tracks</h3>
    <label class="sort">
      <select bind:value={sortOrder} aria-label="Sort tracks">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="name">Name A to Z</option>
        <option value="bpm">Detected BPM, low to high</option>
      </select>
    </label>
    <h3>Row metadata</h3>
    <ToggleSwitch
      bind:checked={showDetectedAnalysis}
      label="Detected BPM and key"
      description="Measured by your default analysis providers, separate from generation targets."
    />
    <ToggleSwitch bind:checked={showTargetMetadata} label="BPM and key targets" />
    <ToggleSwitch bind:checked={showPreset} label="Generation profile" />
    <ToggleSwitch bind:checked={showDate} label="Created date" />
    <ToggleSwitch
      bind:checked={showSeed}
      label="Seed"
      description="Hidden by default because it is useful for reproduction, not browsing."
    />
  </div>
</details>

<style>
  .view-options {
    position: relative;
  }
  summary {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    font-size: var(--font-size-xs);
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover,
  .view-options[open] summary {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  summary:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  .panel {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: 10;
    width: min(290px, calc(100vw - var(--space-6)));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }
  h3 {
    margin: 0 0 var(--space-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
  }
  .sort select {
    width: 100%;
    padding: var(--space-1) var(--space-2);
    color: var(--color-text-primary);
    background: var(--color-bg-inset);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    font-size: var(--font-size-xs);
  }
  .sort select:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
