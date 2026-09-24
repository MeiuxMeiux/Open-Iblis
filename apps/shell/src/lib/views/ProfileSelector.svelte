<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { EngineProfile } from '../../../shared/contract'

  let {
    profiles,
    selected,
    disabled,
    onselect
  }: {
    profiles: EngineProfile[]
    selected: string
    disabled: boolean
    onselect: (id: string) => void
  } = $props()
</script>

{#if profiles.length > 0}
  <label class="field">
    <span>Profile</span>
    <select value={selected} {disabled} onchange={(event) => onselect(event.currentTarget.value)}>
      {#each profiles as profile (profile.id)}
        <option value={profile.id}>
          {profile.name} — {profile.fixedRecipe
            ? profile.synthModel
            : profile.kind === 'validated'
              ? 'validated'
              : 'expert'}
        </option>
      {/each}
    </select>
  </label>
{/if}

<style>
  .field {
    display: flex;
    flex: 1 1 150px;
    min-width: 150px;
    flex-direction: column;
    gap: 6px;
  }
  span {
    color: var(--color-text-secondary);
    font-size: 12px;
  }
  select {
    padding: 9px 11px;
    color: var(--color-text-primary);
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    font: inherit;
  }
  select:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-color: var(--color-accent);
  }
</style>
