<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import {
    PRIVATE_TRAINING_NOTE,
    type TrainingCategory,
    type TrainingReserveResult
  } from '../../../shared/training'
  import Badge from '../ui/Badge.svelte'

  let {
    name = $bindable(''),
    categories = $bindable<TrainingCategory[]>(['texture']),
    reserve = $bindable<TrainingReserveResult | null>(null),
    privateTraining = false,
    onBack,
    onContinue
  }: {
    name?: string
    categories?: TrainingCategory[]
    reserve?: TrainingReserveResult | null
    privateTraining?: boolean
    onBack: () => void
    onContinue: () => void
  } = $props()

  let reserving = $state(false)
  let error = $state<string | null>(null)

  function toggleCategory(category: TrainingCategory): void {
    reserve = null
    categories = categories.includes(category)
      ? categories.filter((c) => c !== category)
      : [...categories, category]
  }

  async function checkName(): Promise<void> {
    if (reserving || categories.length === 0) return
    reserving = true
    error = null
    const result = await window.iblis.training.reserveName(name.trim(), $state.snapshot(categories))
    reserving = false
    if (!result.ok) {
      error = result.error
      return
    }
    reserve = result.data
  }
</script>

{#if privateTraining}
  <p class="note" role="note">{PRIVATE_TRAINING_NOTE}</p>
  <p class="explain">
    Names use 3-40 characters: lowercase letters, digits, and hyphens. Each of your trainings needs
    its own name.
  </p>
{:else}
  <p class="explain">
    The name is public and permanent: 3-40 characters, lowercase letters, digits, and hyphens.
    Re-training a name you own publishes a new version of the same training.
  </p>
{/if}
<div class="name-row">
  <input
    type="text"
    placeholder="my-style-name"
    bind:value={name}
    oninput={() => (reserve = null)}
    aria-label="Training name"
  />
  <button class="primary" onclick={checkName} disabled={reserving || name.trim().length < 3}>
    {reserving ? 'Checking…' : 'Check availability'}
  </button>
</div>
<div class="categories" role="group" aria-label="Categories">
  {#each ['texture', 'groove'] as const as category (category)}
    <button
      class="chip"
      class:selected={categories.includes(category)}
      aria-pressed={categories.includes(category)}
      onclick={() => toggleCategory(category)}
    >
      {category === 'texture' ? 'Texture (sound and timbre)' : 'Groove (rhythm and flow)'}
    </button>
  {/each}
</div>
{#if reserve}
  <p class="reserve" role="status">
    {#if reserve.available}
      {#if reserve.visibility === 'private'}
        <Badge tone="success">Available</Badge>
        {name.trim()} is free on this machine.
      {:else}
        <Badge tone="success">Reserved</Badge>
        {name.trim()} is yours{reserve.version && reserve.version > 1
          ? ` — this will publish version ${reserve.version}`
          : ''}.
      {/if}
    {:else}
      <Badge tone="danger">Unavailable</Badge>
      {reserve.message}
    {/if}
  </p>
{/if}
{#if error}<p class="warn" role="alert">{error}</p>{/if}
<div class="nav">
  <button class="quiet" onclick={onBack}>Back</button>
  <button class="primary" onclick={onContinue} disabled={!reserve?.available}>Continue</button>
</div>

<style>
  .explain {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
  .note {
    margin: 0;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--color-bg-inset);
  }
  .name-row {
    display: flex;
    gap: 10px;
  }
  input {
    flex: 1 1 auto;
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    padding: 9px 11px;
    font-size: 13.5px;
    font-family: inherit;
  }
  input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-color: var(--color-accent);
  }
  .categories {
    display: flex;
    gap: 8px;
  }
  .chip {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 7px 14px;
    border-radius: var(--radius-full);
    font-size: 12.5px;
  }
  .chip.selected {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .reserve {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .warn {
    margin: 0;
    font-size: 12.5px;
    color: var(--color-state-danger);
  }
  .nav {
    display: flex;
    justify-content: space-between;
  }
  .primary {
    border: 1px solid var(--color-accent);
    background: var(--color-accent);
    color: var(--color-text-inverse);
    padding: 9px 20px;
    border-radius: var(--radius-lg);
    font-size: 13.5px;
  }
  .primary:disabled {
    opacity: 0.4;
  }
  .quiet {
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 9px 16px;
    border-radius: var(--radius-lg);
    font-size: 13px;
  }
</style>
