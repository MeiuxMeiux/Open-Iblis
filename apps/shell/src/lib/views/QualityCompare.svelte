<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { EngineProfile } from '../../../shared/contract'
  import type { QueueComparisonVariant } from '../../../shared/generation-queue'

  let {
    disabled,
    profiles,
    oncompare
  }: {
    disabled: boolean
    profiles: EngineProfile[]
    oncompare: (variant: QueueComparisonVariant) => void | Promise<void>
  } = $props()

  let profileId = $state('turbo-expert')
  let expertSteps = $state(12)
  let guidance = $state(1)
  const candidates = $derived(
    profiles.some((profile) => profile.id === 'turbo-validated')
      ? profiles.filter((profile) => profile.id !== 'turbo-validated')
      : []
  )
  const selected = $derived(candidates.find((profile) => profile.id === profileId) ?? null)
  const valid = $derived(
    !!selected &&
      Number.isInteger(expertSteps) &&
      expertSteps >= selected.steps.min &&
      expertSteps <= selected.steps.max &&
      guidance >= selected.guidance.min &&
      guidance <= selected.guidance.max &&
      !(selected.id === 'turbo-expert' && expertSteps === 8 && guidance === 1)
  )

  $effect(() => {
    const first = candidates[0]
    if (selected || !first) return
    choose(first)
  })

  function choose(profile: EngineProfile): void {
    profileId = profile.id
    expertSteps =
      profile.id === 'turbo-expert' && profile.steps.default === 8 ? 12 : profile.steps.default
    guidance = profile.guidance.default
  }
</script>

{#if candidates.length > 0}
  <aside
    class="compare"
    class:with-guidance={!!selected && selected.guidance.min !== selected.guidance.max}
    aria-labelledby="compare-title"
  >
    <div>
      <strong id="compare-title">Blind quality check</strong>
      <p>
        Queue validated turbo against one installed experiment while keeping the blueprint fixed.
      </p>
    </div>
    <label>
      <span>Candidate</span>
      <select
        value={profileId}
        {disabled}
        onchange={(event) => {
          const profile = candidates.find((item) => item.id === event.currentTarget.value)
          if (profile) choose(profile)
        }}
      >
        {#each candidates as profile (profile.id)}
          <option value={profile.id}>{profile.name}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Steps</span>
      <input
        type="number"
        min={selected?.steps.min ?? 1}
        max={selected?.steps.max ?? 50}
        bind:value={expertSteps}
        disabled={disabled || selected?.steps.min === selected?.steps.max}
      />
    </label>
    {#if selected && selected.guidance.min !== selected.guidance.max}
      <label>
        <span>Guidance</span>
        <input
          type="number"
          min={selected.guidance.min}
          max={selected.guidance.max}
          step="0.5"
          bind:value={guidance}
          {disabled}
        />
      </label>
    {/if}
    <button
      type="button"
      disabled={disabled || !valid}
      onclick={() => void oncompare({ profileId, steps: expertSteps, guidance })}
    >
      Queue blind A/B
    </button>
  </aside>
{/if}

<style>
  .compare {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(130px, auto) 82px auto;
    align-items: end;
    gap: 12px;
    padding: 12px;
    background: var(--color-bg-subtle);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
  }
  .compare.with-guidance {
    grid-template-columns: minmax(0, 1fr) minmax(130px, auto) 82px 82px auto;
  }
  strong,
  label span {
    font-size: 12px;
  }
  p {
    margin: 4px 0 0;
    color: var(--color-text-secondary);
    font-size: 11.5px;
    line-height: 1.4;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: var(--color-text-secondary);
  }
  input,
  select,
  button {
    min-height: 34px;
    padding: 7px 9px;
    color: var(--color-text-primary);
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    font: inherit;
  }
  button {
    color: var(--color-text-inverse);
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  button:disabled,
  input:disabled {
    opacity: 0.45;
  }
  input:focus-visible,
  select:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (max-width: 620px) {
    .compare {
      grid-template-columns: 1fr 1fr;
    }
    .compare.with-guidance {
      grid-template-columns: 1fr 1fr;
    }
    .compare > div {
      grid-column: 1 / -1;
    }
  }
</style>
