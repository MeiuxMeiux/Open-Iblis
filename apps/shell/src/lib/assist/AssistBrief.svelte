<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { TextProviderId } from '../../../shared/text-assist'
  import { BRIEF_LIMITS, LYRICS_STRUCTURES } from '../../../shared/assist-prompts'
  import type { AssistFlow } from './assist-flow.svelte'

  // The brief step: what to write, then which provider and model to ask.
  let { flow }: { flow: AssistFlow } = $props()

  const structures = Object.entries(LYRICS_STRUCTURES) as [
    keyof typeof LYRICS_STRUCTURES,
    { label: string }
  ][]
</script>

<div class="brief">
  {#if flow.task === 'lyrics-assistance'}
    <label>
      <span>What is the song about?</span>
      <textarea
        bind:value={flow.topic}
        rows="2"
        maxlength={BRIEF_LIMITS.topic}
        placeholder="leaving a small town at night, headlights on wet roads"></textarea>
    </label>
    <div class="pair">
      <label>
        <span>Mood</span>
        <input bind:value={flow.mood} maxlength={BRIEF_LIMITS.mood} placeholder="bittersweet" />
      </label>
      <label>
        <span>Language</span>
        <input bind:value={flow.language} maxlength={BRIEF_LIMITS.language} />
      </label>
    </div>
    <label>
      <span>Structure</span>
      <select bind:value={flow.structure}>
        {#each structures as [id, structure] (id)}
          <option value={id}>{structure.label}</option>
        {/each}
      </select>
    </label>
  {:else}
    <label>
      <span>Starting point (optional)</span>
      <input
        bind:value={flow.seed}
        maxlength={BRIEF_LIMITS.seed}
        placeholder="rainy synthwave for a night drive"
      />
    </label>
  {/if}

  {#if flow.options}
    <div class="pair">
      <label>
        <span>Provider</span>
        <select
          value={flow.providerId}
          onchange={(event) => flow.selectProvider(event.currentTarget.value as TextProviderId)}
        >
          {#each flow.options.providers as provider (provider.id)}
            <option value={provider.id}>
              {provider.name}{provider.available ? '' : ' (not set up)'}
            </option>
          {/each}
        </select>
      </label>
      <label>
        <span>Model</span>
        <select bind:value={flow.modelId} disabled={!flow.provider?.available}>
          {#each flow.provider?.models ?? [] as model (model.id)}
            <option value={model.id}>{model.name}</option>
          {/each}
        </select>
      </label>
    </div>
    {#if flow.provider && !flow.provider.available}
      <p class="reason" role="status">{flow.provider.reason}</p>
    {/if}
  {:else if !flow.error}
    <p class="reason" role="status">Checking providers...</p>
  {/if}
</div>

<style>
  .brief {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  label span,
  .reason {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary);
  }
  input,
  select,
  textarea {
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    background: var(--app-surface);
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  textarea {
    resize: vertical;
  }
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  @media (max-width: 480px) {
    .pair {
      grid-template-columns: 1fr;
    }
  }
</style>
