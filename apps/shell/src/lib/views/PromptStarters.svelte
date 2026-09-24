<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import { PROMPT_STARTERS, type PromptStarter } from './prompt-starters'
  import PromptHistory from './PromptHistory.svelte'

  let {
    disabled,
    prompt = $bindable<string>(),
    // Written only in pick(); the $bindable write flows back to the parent.
    // eslint-disable-next-line no-useless-assignment
    negative = $bindable<string>()
  }: { disabled: boolean; prompt?: string; negative?: string } = $props()

  function pick(starter: PromptStarter): void {
    prompt = starter.prompt
    negative = starter.negativePrompt
  }
</script>

<div class="field">
  <div class="labelrow">
    <span>Prompt</span>
    <PromptHistory onpick={(text: string) => (prompt = text)} />
  </div>
  <textarea
    bind:value={prompt}
    rows="3"
    aria-label="Prompt"
    placeholder="instrumental, neurofunk, drum and bass, 174 bpm, dark, heavy sound design"
    {disabled}></textarea>
</div>

<fieldset class="starters" {disabled}>
  <legend>Bass prompt starters</legend>
  <p>Choose one to fill the editable prompt and Avoid fields.</p>
  <div class="choices">
    {#each PROMPT_STARTERS as starter (starter.id)}
      <button type="button" onclick={() => pick(starter)}>
        {starter.name}
      </button>
    {/each}
  </div>
</fieldset>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .labelrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .labelrow span,
  legend {
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  textarea {
    resize: vertical;
  }
  textarea,
  button {
    font-family: inherit;
  }
  textarea {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--app-surface);
    color: var(--color-text-primary);
    padding: 9px 11px;
    font-size: 13.5px;
  }
  textarea:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-color: var(--color-accent);
  }
  .starters {
    margin: 0;
    min-width: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
  }
  p {
    margin: 4px 0 8px;
    font-size: 11.5px;
    color: var(--color-text-secondary);
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  button {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 5px 9px;
    font-size: 12px;
  }
  button:hover:not(:disabled) {
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }
  button:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
  fieldset:disabled {
    opacity: 0.55;
  }
</style>
