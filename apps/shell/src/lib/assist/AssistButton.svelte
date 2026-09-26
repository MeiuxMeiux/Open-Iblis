<!-- SPDX-FileCopyrightText: 2026 Meiux Meiux LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

<script lang="ts">
  import type { AssistTask } from '../../../shared/text-assist'
  import Icon from '../ui/Icon.svelte'
  import AssistDialog from './AssistDialog.svelte'

  // The small "Write lyrics" / "Song idea" action beside a Create field.
  let {
    task,
    current,
    disabled = false,
    oninsert
  }: {
    task: AssistTask
    current: string
    disabled?: boolean
    oninsert: (text: string) => void
  } = $props()

  let open = $state(false)
</script>

<button
  class="assist"
  type="button"
  {disabled}
  aria-haspopup="dialog"
  onclick={() => (open = true)}
>
  <Icon name="edit" size={13} />
  <span>{task === 'lyrics-assistance' ? 'Write lyrics' : 'Song idea'}</span>
</button>
{#if open}
  <AssistDialog {task} {current} {oninsert} onclose={() => (open = false)} />
{/if}

<style>
  .assist {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    border-radius: var(--radius-lg);
    padding: 2px 10px;
    font-size: 11.5px;
    font-family: inherit;
  }
  .assist:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
  .assist:disabled {
    opacity: 0.55;
  }
  .assist:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }
</style>
