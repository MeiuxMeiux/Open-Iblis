<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { EngineCapabilities, EngineInfo, EngineProfile } from '../../../shared/contract'
  import type { Steering } from './steering.svelte'
  import ToggleSwitch from '../ui/ToggleSwitch.svelte'
  import EngineControls from './EngineControls.svelte'
  import DescriptorControls from './DescriptorControls.svelte'

  type EngineRuntime = NonNullable<EngineInfo['runtime']>

  // The steering fields below the prompt: negative prompt, the lyrics box
  // (vocals mode 'lyrics' only), and the Advanced knobs. State lives in the
  // shared Steering object so Generate.svelte owns a single source of truth.
  // Every control below is gated by the selected engine's signed
  // capabilities; an undeclared control is not rendered (roadmap 4D).
  let {
    steering,
    profile,
    runtime,
    capabilities,
    disabled
  }: {
    steering: Steering
    profile: EngineProfile | null
    runtime: EngineRuntime | null
    capabilities: EngineCapabilities | null
    disabled: boolean
  } = $props()

  const common = $derived(capabilities?.commonControls ?? [])
  const native = $derived(capabilities?.nativeTuning ?? true)
  const shows = $derived((key: (typeof common)[number]) => !capabilities || common.includes(key))
  const hasAdvanced = $derived(
    shows('bpm') || shows('keyscale') || native || (capabilities?.advancedControls.length ?? 0) > 0
  )
</script>

{#if shows('negativePrompt')}
  <label class="field">
    <span>Avoid (negative prompt)</span>
    <input
      bind:value={steering.negative}
      placeholder="pop, cheerful, clean, radio-friendly"
      {disabled}
    />
  </label>
{/if}

{#if steering.vocals === 'lyrics' && capabilities?.lyrics !== 'none'}
  <label class="field">
    <span>Lyrics</span>
    <textarea bind:value={steering.lyricsText} rows="5" placeholder="[verse]&#10;..." {disabled}
    ></textarea>
  </label>
{/if}

{#if hasAdvanced}
  <details class="advanced" bind:open={steering.advancedOpen}>
    <summary>Advanced</summary>
    <div class="row">
      {#if shows('bpm')}
        <label class="field">
          <span>BPM</span>
          <input
            type="number"
            min="1"
            max="400"
            bind:value={steering.bpm}
            placeholder="auto"
            {disabled}
          />
        </label>
      {/if}
      {#if shows('keyscale')}
        <label class="field">
          <span>Key</span>
          <input bind:value={steering.keyscale} placeholder="F minor" {disabled} />
        </label>
      {/if}
      {#if !native && shows('timeSignature')}
        <label class="field">
          <span>Beats per bar</span>
          <select bind:value={steering.timeSignature} {disabled}>
            <option value="">Auto</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="6">6</option>
          </select>
        </label>
      {/if}
    </div>
    {#if native}
      <EngineControls {steering} {profile} {runtime} {disabled} />
      <div class="rewrite">
        <ToggleSwitch
          bind:checked={steering.rewritePrompt}
          label="Rewrite prompt"
          description="Let the engine expand the prompt. Turn this off when the BPM, key, and wording must stay exact."
          {disabled}
        />
      </div>
    {:else if capabilities}
      <DescriptorControls
        controls={capabilities.advancedControls}
        bind:values={steering.advanced}
        {disabled}
      />
    {/if}
  </details>
{/if}

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field span {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  textarea,
  select,
  input {
    background: var(--app-surface);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    padding: 9px 11px;
    font-size: 13.5px;
    font-family: inherit;
    resize: vertical;
  }
  textarea:focus-visible,
  select:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-color: var(--color-accent);
  }
  .row {
    display: flex;
    gap: 14px;
  }
  .row .field {
    flex: 1 1 0;
  }
  .row:empty {
    display: none;
  }
  .advanced summary {
    font-size: 12px;
    color: var(--color-text-secondary);
    cursor: pointer;
    user-select: none;
  }
  .advanced[open] summary {
    margin-bottom: 12px;
  }
  .rewrite {
    margin-top: 12px;
  }
</style>
