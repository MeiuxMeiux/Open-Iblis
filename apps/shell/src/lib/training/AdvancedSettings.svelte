<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import {
    resolveTierPreview,
    TRAINING_SETTING_BOUNDS,
    type TrainingAdvancedSettings
  } from '../../../shared/training'

  let {
    settings = $bindable({}),
    vramTotalMb
  }: { settings?: TrainingAdvancedSettings; vramTotalMb: number | null } = $props()

  let open = $state(false)
  const tier = $derived(resolveTierPreview(vramTotalMb))
  const overrideCount = $derived(
    Object.values(settings).filter((value) => value !== undefined).length
  )

  // Numbers arrive from inputs as strings; store a clamped number or drop the
  // key so the pack falls back to its tier default.
  function clearKey(key: keyof TrainingAdvancedSettings) {
    settings = Object.fromEntries(Object.entries(settings).filter(([name]) => name !== key))
  }

  function setNumber(key: 'rank' | 'epochs' | 'batchSize' | 'gradientAccumulation', raw: string) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      clearKey(key)
      return
    }
    const bound = TRAINING_SETTING_BOUNDS[key]
    const parsed = Math.round(Number(trimmed))
    if (!Number.isFinite(parsed)) return
    settings = { ...settings, [key]: Math.max(bound.min, Math.min(bound.max, parsed)) }
  }

  function setChoice<K extends keyof TrainingAdvancedSettings>(
    key: K,
    value: TrainingAdvancedSettings[K] | ''
  ) {
    if (value === '' || value === undefined) {
      clearKey(key)
      return
    }
    settings = { ...settings, [key]: value }
  }

  // Auto / On / Off tri-state for the two boolean guards.
  function triValue(v: boolean | undefined): 'auto' | 'on' | 'off' {
    return v === undefined ? 'auto' : v ? 'on' : 'off'
  }
  function setTri(key: 'gradientCheckpointing' | 'offloadEncoder', v: string) {
    if (v === 'auto') {
      setChoice(key, '')
      return
    }
    setChoice(key, v === 'on')
  }

  function resetAll() {
    settings = {}
  }
</script>

<div class="advanced">
  <button class="head" type="button" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="chevron" class:open>›</span>
    <span class="title">Advanced settings</span>
    <span class="tier">
      Auto: {tier.label} tier — rank {tier.rank}, {tier.optimizer}{overrideCount > 0
        ? ` · ${overrideCount} override${overrideCount === 1 ? '' : 's'}`
        : ''}
    </span>
  </button>

  {#if open}
    <p class="note">
      Leave anything on Auto and Iblis picks the tuned value for your {tier.label} card. Overrides are
      clamped to safe ranges. Lower rank and encoder offload are what let 8 GB cards finish; big-VRAM
      cards can raise rank and batch size for more capacity and speed.
    </p>

    <div class="grid">
      <label>
        <span>Rank</span>
        <input
          type="number"
          min={TRAINING_SETTING_BOUNDS.rank.min}
          max={TRAINING_SETTING_BOUNDS.rank.max}
          placeholder="auto ({tier.rank})"
          value={settings.rank ?? ''}
          oninput={(e) => setNumber('rank', e.currentTarget.value)}
        />
      </label>

      <label>
        <span>Epochs</span>
        <input
          type="number"
          min={TRAINING_SETTING_BOUNDS.epochs.min}
          max={TRAINING_SETTING_BOUNDS.epochs.max}
          placeholder="auto (500)"
          value={settings.epochs ?? ''}
          oninput={(e) => setNumber('epochs', e.currentTarget.value)}
        />
      </label>

      <label>
        <span>Batch size</span>
        <input
          type="number"
          min={TRAINING_SETTING_BOUNDS.batchSize.min}
          max={TRAINING_SETTING_BOUNDS.batchSize.max}
          placeholder="auto"
          value={settings.batchSize ?? ''}
          oninput={(e) => setNumber('batchSize', e.currentTarget.value)}
        />
      </label>

      <label>
        <span>Grad. accumulation</span>
        <input
          type="number"
          min={TRAINING_SETTING_BOUNDS.gradientAccumulation.min}
          max={TRAINING_SETTING_BOUNDS.gradientAccumulation.max}
          placeholder="auto"
          value={settings.gradientAccumulation ?? ''}
          oninput={(e) => setNumber('gradientAccumulation', e.currentTarget.value)}
        />
      </label>

      <label>
        <span>Optimizer</span>
        <select
          value={settings.optimizer ?? ''}
          onchange={(e) =>
            setChoice('optimizer', e.currentTarget.value as 'adamw' | 'adafactor' | '')}
        >
          <option value="">Auto ({tier.optimizer})</option>
          <option value="adamw">AdamW</option>
          <option value="adafactor">Adafactor (low memory)</option>
        </select>
      </label>

      <label>
        <span>Precision</span>
        <select
          value={settings.precision ?? ''}
          onchange={(e) => setChoice('precision', e.currentTarget.value as never)}
        >
          <option value="">Auto</option>
          <option value="bf16">bf16</option>
          <option value="fp16">fp16</option>
          <option value="fp32">fp32</option>
        </select>
      </label>

      <label>
        <span>Grad. checkpointing</span>
        <select
          value={triValue(settings.gradientCheckpointing)}
          onchange={(e) => setTri('gradientCheckpointing', e.currentTarget.value)}
        >
          <option value="auto">Auto</option>
          <option value="on">On (less VRAM)</option>
          <option value="off">Off (faster)</option>
        </select>
      </label>

      <label>
        <span>Encoder offload</span>
        <select
          value={triValue(settings.offloadEncoder)}
          onchange={(e) => setTri('offloadEncoder', e.currentTarget.value)}
        >
          <option value="auto">Auto ({tier.offloadEncoder ? 'on' : 'off'})</option>
          <option value="on">On (less VRAM)</option>
          <option value="off">Off (faster)</option>
        </select>
      </label>
    </div>

    {#if overrideCount > 0}
      <button class="reset" type="button" onclick={resetAll}>Reset to auto</button>
    {/if}
  {/if}
</div>

<style>
  .advanced {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    color: var(--color-text-primary);
  }
  .chevron {
    transition: transform 0.12s ease;
    color: var(--color-text-muted);
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .title {
    font-size: 13.5px;
    font-weight: 600;
  }
  .tier {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--color-text-muted);
  }
  .note {
    margin: 0;
    padding: 0 12px 8px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    padding: 0 12px 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  input,
  select {
    padding: 6px 8px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--app-bg);
    color: var(--color-text-primary);
    font-size: 12.5px;
  }
  .reset {
    margin: 0 12px 12px;
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 6px 12px;
    border-radius: var(--radius-md);
    font-size: 12px;
    cursor: pointer;
  }
</style>
