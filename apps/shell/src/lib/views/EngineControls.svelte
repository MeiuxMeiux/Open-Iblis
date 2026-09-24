<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { EngineInfo, EngineProfile } from '../../../shared/contract'
  import type { Steering } from './steering.svelte'

  type EngineRuntime = NonNullable<EngineInfo['runtime']>

  let {
    steering,
    profile,
    runtime,
    disabled
  }: {
    steering: Steering
    profile: EngineProfile | null
    runtime: EngineRuntime | null
    disabled: boolean
  } = $props()

  const expertLocked = $derived(disabled || profile?.kind !== 'expert')
  const stepsLocked = $derived(expertLocked || !profile || profile.steps.min === profile.steps.max)
  const guidanceLocked = $derived(
    disabled || !profile || profile.guidance.min === profile.guidance.max
  )
</script>

{#if profile}
  <p class="profile-note" class:expert={profile.kind === 'expert'}>
    {#if profile.kind === 'validated'}
      Validated recipe: turbo at {profile.steps.default} steps with guidance {profile.guidance
        .default}.
    {:else if profile.id === 'xl-turbo-experiment'}
      XL turbo experiment: the 4B DiT at {profile.steps.default} fixed steps with guidance {profile
        .guidance.default}, so it differs from Turbo / 8 by model only. An installed bakeoff
      candidate, not a quality tier.
    {:else if profile.id === 'sft-experiment'}
      SFT experiment: {profile.steps.default} fixed steps with guidance from {profile.guidance.min}
      to {profile.guidance.max}. This is an experimental installed model, not a quality tier.
    {:else}
      Expert experiment: turbo steps from {profile.steps.min} to {profile.steps.max}, with advanced
      shift and solver controls. More steps are not a different quality model.
    {/if}
  </p>
{/if}

<div class="engine-grid">
  <label class="field">
    <span>Language model</span>
    <select bind:value={steering.lmModel} {disabled}>
      {#each runtime?.lmModels ?? [] as model (model)}
        <option value={model}>{model}</option>
      {/each}
    </select>
  </label>
  <label class="field">
    <span>Synthesis model (profile fixed)</span>
    <select bind:value={steering.synthModel} disabled>
      {#each runtime?.synthModels ?? [] as model (model)}
        <option value={model}>{model}</option>
      {/each}
    </select>
  </label>
  <label class="field compact">
    <span>Steps</span>
    <input
      type="number"
      min={profile?.steps.min ?? 1}
      max={profile?.steps.max ?? 20}
      bind:value={steering.steps}
      disabled={stepsLocked}
    />
  </label>
  <label class="field compact">
    <span>Guidance {guidanceLocked ? '(profile fixed)' : ''}</span>
    <input
      type="number"
      min={profile?.guidance.min ?? 1}
      max={profile?.guidance.max ?? 7}
      step="0.5"
      bind:value={steering.guidance}
      disabled={guidanceLocked}
    />
  </label>
  <label class="field compact">
    <span>Shift</span>
    <input
      type="number"
      min="0.1"
      max="20"
      step="0.1"
      bind:value={steering.shift}
      disabled={expertLocked}
    />
  </label>
  <label class="field">
    <span>Solver</span>
    <select bind:value={steering.solver} disabled={expertLocked}>
      {#each runtime?.solvers ?? [] as solver (solver)}
        <option value={solver}>{solver}</option>
      {/each}
    </select>
  </label>
  <label class="field compact">
    <span>Beats per bar</span>
    <select bind:value={steering.timeSignature} {disabled}>
      <option value="">Auto</option>
      <option value="2">2</option>
      <option value="3">3</option>
      <option value="4">4</option>
      <option value="6">6</option>
    </select>
  </label>
  <label class="field compact">
    <span>LM seed (optional)</span>
    <input bind:value={steering.lmSeedText} placeholder="random" inputmode="numeric" {disabled} />
  </label>
  <label class="field">
    <span>Adapter</span>
    <select bind:value={steering.adapter} disabled={disabled || !runtime?.adapters.length}>
      <option value="">None</option>
      {#each runtime?.adapters ?? [] as adapter (adapter)}
        <option value={adapter}>{adapter}</option>
      {/each}
    </select>
  </label>
  <label class="field compact">
    <span>Adapter scale</span>
    <input
      type="number"
      min="0"
      max="2"
      step="0.05"
      bind:value={steering.adapterScale}
      placeholder="1.0"
      disabled={disabled || !steering.adapter}
    />
  </label>
</div>

<style>
  .profile-note {
    margin: 0 0 12px;
    padding: 9px 11px;
    color: var(--color-text-secondary);
    background: var(--color-bg-subtle);
    border-left: 2px solid var(--color-accent);
    border-radius: var(--radius-md);
    font-size: 12px;
    line-height: 1.45;
  }
  .profile-note.expert {
    border-left-color: var(--color-state-warning);
  }
  .engine-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 14px;
  }
  .field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
  }
  .field span {
    color: var(--color-text-secondary);
    font-size: 12px;
  }
  input,
  select {
    min-width: 0;
    padding: 9px 11px;
    color: var(--color-text-primary);
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    font: inherit;
  }
  input:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-color: var(--color-accent);
  }
  input:disabled,
  select:disabled {
    opacity: 0.65;
  }
  @media (max-width: 620px) {
    .engine-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
