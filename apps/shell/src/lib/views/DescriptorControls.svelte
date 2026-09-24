<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { EngineAdvancedControlV2 } from '@iblis/plugin-sdk'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'
  import type { AdvancedValues } from './steering.svelte'

  // Bounded advanced controls rendered straight from the selected engine's
  // signed descriptor: one field per declared control, of the declared kind,
  // within the declared bounds. Nothing here exists unless the engine says so.
  let {
    controls,
    values = $bindable({}),
    disabled
  }: {
    controls: EngineAdvancedControlV2[]
    // Optional only for the $bindable fallback; SteeringControls always binds.
    values?: AdvancedValues
    disabled: boolean
  } = $props()

  function numberOf(control: EngineAdvancedControlV2, raw: string): number {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || control.kind === 'boolean' || control.kind === 'enum') {
      return control.default as number
    }
    const bounded = Math.min(control.max, Math.max(control.min, parsed))
    return control.kind === 'integer' ? Math.round(bounded) : bounded
  }

  function stepOf(control: EngineAdvancedControlV2): string {
    if (control.kind === 'integer') return '1'
    if (control.kind === 'number') return control.step ? String(control.step) : 'any'
    return 'any'
  }
</script>

{#if controls.length > 0}
  <div class="grid">
    {#each controls as control (control.id)}
      {#if control.kind === 'boolean'}
        <div class="toggle">
          <ToggleSwitch
            checked={values[control.id] === true}
            label={control.label}
            description={control.help}
            {disabled}
            onToggle={(next: boolean) => (values[control.id] = next)}
          />
        </div>
      {:else if control.kind === 'enum'}
        <label class="field">
          <span>{control.label}</span>
          <select
            value={String(values[control.id] ?? control.default)}
            {disabled}
            onchange={(event) => (values[control.id] = event.currentTarget.value)}
          >
            {#each control.values as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
          {#if control.help}<small>{control.help}</small>{/if}
        </label>
      {:else}
        <label class="field">
          <span>{control.label} ({control.min} to {control.max})</span>
          <input
            type="number"
            min={control.min}
            max={control.max}
            step={stepOf(control)}
            value={values[control.id] ?? control.default}
            {disabled}
            onchange={(event) =>
              (values[control.id] = numberOf(control, event.currentTarget.value))}
          />
          {#if control.help}<small>{control.help}</small>{/if}
        </label>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 14px;
  }
  .toggle {
    grid-column: 1 / -1;
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
  .field small {
    color: var(--color-text-secondary);
    font-size: 11.5px;
    line-height: 1.4;
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
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
